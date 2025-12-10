use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use secp256k1::{Secp256k1, SecretKey, Message, PublicKey};
use rand_core::RngCore;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MarketType {
    PickRange,
    EvenOdd,
    LastDigit,
    ModuloThree,
    PatternOfDay,
    ShapeColor,
    Jackpot,
    EntropyBattle,
    StreakMeter,
    CommunitySeed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OutcomeType {
    Numeric { value: u16 },
    Shape { shape: u8, color: u8, size: u8 },
    Pattern { pattern_id: u8, matched_value: u16 },
    Entropy { tee_score: u16, chain_score: u16, sensor_score: u16, winner: u8 },
    Community { final_byte: u8, seed_hash: [u8; 32] },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attestation {
    pub round_id: String,
    pub market_type: MarketType,
    pub outcome: OutcomeType,
    pub inputs_hash: [u8; 32],
    pub code_measurement: [u8; 32],
    pub signature: Vec<u8>,
    pub public_key: Vec<u8>,
    pub timestamp: i64,
}

pub struct TeeEngine {
    secret_key: SecretKey,
    public_key: PublicKey,
    secp: Secp256k1<secp256k1::All>,
    streak_state: HashMap<String, u16>,
}

impl TeeEngine {
    pub fn new() -> Self {
        let secp = Secp256k1::new();

        // Generate TEE keypair using hardware entropy (RDRAND)
        let mut rng = TeeRng::new();
        let secret_key = SecretKey::new(&mut rng);
        let public_key = PublicKey::from_secret_key(&secp, &secret_key);

        Self {
            secret_key,
            public_key,
            secp,
            streak_state: HashMap::new(),
        }
    }

    pub fn get_public_key_bytes(&self) -> Vec<u8> {
        self.public_key.serialize_uncompressed().to_vec()
    }

    pub fn generate_outcome(&mut self, round_id: String, market_type: MarketType, params: OutcomeParams) -> Result<Attestation, String> {
        let mut rng = TeeRng::new();

        let outcome = match market_type {
            MarketType::PickRange => self.generate_range_outcome(&mut rng),
            MarketType::EvenOdd => self.generate_even_odd_outcome(&mut rng),
            MarketType::LastDigit => self.generate_last_digit_outcome(&mut rng),
            MarketType::ModuloThree => self.generate_modulo_outcome(&mut rng),
            MarketType::PatternOfDay => self.generate_pattern_outcome(&mut rng),
            MarketType::ShapeColor => self.generate_shape_outcome(&mut rng),
            MarketType::Jackpot => self.generate_jackpot_outcome(&mut rng),
            MarketType::EntropyBattle => self.generate_entropy_outcome(&mut rng, params.chain_hash),
            MarketType::StreakMeter => {
                return Err("Streak is stateful, use update_streak instead".to_string());
            },
            MarketType::CommunitySeed => {
                self.generate_community_outcome(params.community_seeds.unwrap_or_default())
            },
        };

        self.create_attestation(round_id, market_type, outcome)
    }

    fn generate_range_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let value = (rng.next_u32() % 100 + 1) as u16;
        OutcomeType::Numeric { value }
    }

    fn generate_even_odd_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let value = (rng.next_u32() % 2) as u16;
        OutcomeType::Numeric { value }
    }

    fn generate_last_digit_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let value = (rng.next_u32() % 10) as u16;
        OutcomeType::Numeric { value }
    }

    fn generate_modulo_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let value = (rng.next_u32() % 3) as u16;
        OutcomeType::Numeric { value }
    }

    fn generate_pattern_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let value = (rng.next_u32() % 1000) as u16;

        let pattern_id = if Self::is_prime(value) {
            0 // Prime
        } else if Self::is_fibonacci(value) {
            1 // Fibonacci
        } else if Self::is_perfect_square(value) {
            2 // Perfect Square
        } else if value % 10 == 7 {
            3 // Ends with 7
        } else if Self::is_palindrome(value) {
            4 // Palindrome
        } else if value % 2 == 0 {
            5 // Even
        } else {
            6 // Odd
        };

        OutcomeType::Pattern { pattern_id, matched_value: value }
    }

    fn generate_shape_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let shape = (rng.next_u32() % 4) as u8; // 4 shapes: circle, square, triangle, star
        let color = (rng.next_u32() % 6) as u8; // 6 colors
        let size = (rng.next_u32() % 3) as u8; // 3 sizes: small, medium, large

        OutcomeType::Shape { shape, color, size }
    }

    fn generate_jackpot_outcome(&self, rng: &mut TeeRng) -> OutcomeType {
        let value = (rng.next_u32() % 100) as u16;
        OutcomeType::Numeric { value }
    }

    fn generate_entropy_outcome(&self, rng: &mut TeeRng, chain_hash: Option<[u8; 32]>) -> OutcomeType {
        let tee_bytes = self.generate_entropy_bytes(rng, 32);
        let tee_score = Self::calculate_entropy_score(&tee_bytes);

        let chain_bytes = chain_hash.unwrap_or_else(|| [0u8; 32]);
        let chain_score = Self::calculate_entropy_score(&chain_bytes);

        let sensor_bytes = self.fetch_sensor_entropy();
        let sensor_score = Self::calculate_entropy_score(&sensor_bytes);

        let winner = if tee_score >= chain_score && tee_score >= sensor_score {
            0
        } else if chain_score >= tee_score && chain_score >= sensor_score {
            1
        } else {
            2
        };

        OutcomeType::Entropy {
            tee_score,
            chain_score,
            sensor_score,
            winner,
        }
    }

    fn generate_community_outcome(&self, seeds: Vec<u8>) -> OutcomeType {
        if seeds.is_empty() {
            return OutcomeType::Community {
                final_byte: 0,
                seed_hash: [0u8; 32],
            };
        }

        let mut hasher = Sha256::new();
        hasher.update(&seeds);
        let hash_result = hasher.finalize();

        let mut seed_hash = [0u8; 32];
        seed_hash.copy_from_slice(&hash_result);
        let final_byte = seed_hash[31];

        OutcomeType::Community { final_byte, seed_hash }
    }

    pub fn update_streak(&mut self, wallet: String, won: bool, _target: u16) -> u16 {
        let current = self.streak_state.get(&wallet).copied().unwrap_or(0);

        let new_streak = if won {
            current + 1
        } else {
            0 // Reset on loss
        };

        self.streak_state.insert(wallet, new_streak);
        new_streak
    }

    pub fn get_streak(&self, wallet: &str) -> u16 {
        self.streak_state.get(wallet).copied().unwrap_or(0)
    }

    fn fetch_sensor_entropy(&self) -> Vec<u8> {
        use std::net::TcpStream;
        use std::io::{Read, Write};

        const SENSOR_ORACLE: &str = "sensor-oracle.tokku.gg:8443";

        match TcpStream::connect(SENSOR_ORACLE) {
            Ok(mut stream) => {
                let request = b"GET /entropy/32\n";
                let _ = stream.write_all(request);

                let mut buffer = vec![0u8; 32];
                match stream.read_exact(&mut buffer) {
                    Ok(_) => buffer,
                    Err(_) => self.fallback_entropy(),
                }
            }
            Err(_) => self.fallback_entropy(),
        }
    }

    fn fallback_entropy(&self) -> Vec<u8> {
        let mut rng = TeeRng::new();
        let mut bytes = vec![0u8; 32];
        rng.fill_bytes(&mut bytes);
        bytes
    }

    fn generate_entropy_bytes(&self, rng: &mut TeeRng, count: usize) -> Vec<u8> {
        let mut bytes = vec![0u8; count];
        rng.fill_bytes(&mut bytes);
        bytes
    }

    fn calculate_entropy_score(bytes: &[u8]) -> u16 {
        // Shannon entropy calculation
        let mut freq = [0u32; 256];
        for &byte in bytes {
            freq[byte as usize] += 1;
        }

        let len = bytes.len() as f64;
        let mut entropy = 0.0;

        for &count in &freq {
            if count > 0 {
                let p = count as f64 / len;
                entropy -= p * p.log2();
            }
        }

        // Scale to 0-1000 range
        (entropy * 125.0) as u16
    }

    fn create_attestation(&self, round_id: String, market_type: MarketType, outcome: OutcomeType) -> Result<Attestation, String> {
        let inputs = serde_json::to_string(&(&round_id, &market_type, &outcome))
            .map_err(|e| format!("Serialization error: {}", e))?;

        let mut hasher = Sha256::new();
        hasher.update(inputs.as_bytes());
        let inputs_hash_result = hasher.finalize();
        let mut inputs_hash = [0u8; 32];
        inputs_hash.copy_from_slice(&inputs_hash_result);

        let code_measurement = Self::get_code_measurement();

        let message = Message::from_slice(&inputs_hash)
            .map_err(|e| format!("Message creation error: {}", e))?;

        let signature = self.secp.sign_ecdsa(&message, &self.secret_key);
        let signature_bytes = signature.serialize_compact().to_vec();

        let timestamp = Self::get_timestamp();

        Ok(Attestation {
            round_id,
            market_type,
            outcome,
            inputs_hash,
            code_measurement,
            signature: signature_bytes,
            public_key: self.get_public_key_bytes(),
            timestamp,
        })
    }

    fn get_code_measurement() -> [u8; 32] {
        #[cfg(target_env = "sgx")]
        {
            extern "C" {
                fn sgx_self_report(report: *mut [u8; 432]) -> i32;
            }
            let mut report = [0u8; 432];
            unsafe { sgx_self_report(&mut report); }
            let mut measurement = [0u8; 32];
            measurement.copy_from_slice(&report[112..144]);
            measurement
        }

        #[cfg(not(target_env = "sgx"))]
        {
            let mut hasher = Sha256::new();
            hasher.update(b"tokku-tee-engine-0.1.0");
            let result = hasher.finalize();
            let mut measurement = [0u8; 32];
            measurement.copy_from_slice(&result);
            measurement
        }
    }

    fn get_timestamp() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }

    // Pattern checking functions
    fn is_prime(n: u16) -> bool {
        if n < 2 { return false; }
        if n == 2 { return true; }
        if n % 2 == 0 { return false; }

        let sqrt = (n as f64).sqrt() as u16;
        for i in (3..=sqrt).step_by(2) {
            if n % i == 0 { return false; }
        }
        true
    }

    fn is_fibonacci(n: u16) -> bool {
        let fibs: [u16; 17] = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
        fibs.contains(&n)
    }

    fn is_perfect_square(n: u16) -> bool {
        let sqrt = (n as f64).sqrt();
        sqrt.fract() == 0.0
    }

    fn is_palindrome(n: u16) -> bool {
        let s = n.to_string();
        s.chars().eq(s.chars().rev())
    }
}

// Hardware-based RNG using Intel RDRAND (available in Intel TDX)
pub struct TeeRng;

impl TeeRng {
    pub fn new() -> Self {
        Self
    }
}

impl RngCore for TeeRng {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0u8; 4];
        self.fill_bytes(&mut bytes);
        u32::from_le_bytes(bytes)
    }

    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0u8; 8];
        self.fill_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        getrandom::getrandom(dest).expect("Failed to get random bytes from hardware");
    }

    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core::Error> {
        getrandom::getrandom(dest)
            .map_err(|_| rand_core::Error::from(std::num::NonZeroU32::new(1).unwrap()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OutcomeParams {
    pub chain_hash: Option<[u8; 32]>,
    pub community_seeds: Option<Vec<u8>>,
}

// Export TEE public functions that will be called via MagicBlock RPC
#[no_mangle]
pub extern "C" fn tee_init() -> *mut TeeEngine {
    Box::into_raw(Box::new(TeeEngine::new()))
}

#[no_mangle]
pub extern "C" fn tee_get_public_key(engine: *mut TeeEngine) -> *const u8 {
    let engine = unsafe { &*engine };
    let key = engine.get_public_key_bytes();
    let boxed = Box::new(key);
    Box::into_raw(boxed) as *const u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prime_detection() {
        assert!(TeeEngine::is_prime(2));
        assert!(TeeEngine::is_prime(13));
        assert!(!TeeEngine::is_prime(4));
        assert!(!TeeEngine::is_prime(1));
    }

    #[test]
    fn test_fibonacci() {
        assert!(TeeEngine::is_fibonacci(13));
        assert!(TeeEngine::is_fibonacci(89));
        assert!(!TeeEngine::is_fibonacci(15));
    }

    #[test]
    fn test_random_generation() {
        let mut engine = TeeEngine::new();
        let outcome = engine.generate_outcome(
            "test-round-1".to_string(),
            MarketType::PickRange,
            OutcomeParams::default()
        ).unwrap();

        match outcome.outcome {
            OutcomeType::Numeric { value } => {
                assert!(value >= 1 && value <= 100);
            },
            _ => panic!("Expected Numeric outcome"),
        }
    }

    #[test]
    fn test_streak_tracking() {
        let mut engine = TeeEngine::new();
        let wallet = "test-wallet".to_string();

        assert_eq!(engine.update_streak(wallet.clone(), true, 3), 1);
        assert_eq!(engine.update_streak(wallet.clone(), true, 3), 2);
        assert_eq!(engine.update_streak(wallet.clone(), false, 3), 0);
        assert_eq!(engine.update_streak(wallet.clone(), true, 3), 1);
    }

    #[test]
    fn test_community_seed() {
        let engine = TeeEngine::new();
        let seeds = vec![42, 100, 200, 15, 255];

        let outcome = engine.generate_community_outcome(seeds);
        match outcome {
            OutcomeType::Community { final_byte, seed_hash } => {
                assert_ne!(seed_hash, [0u8; 32]);
                assert!(final_byte < 256);
            },
            _ => panic!("Expected Community outcome"),
        }
    }

    #[test]
    fn test_signature_verification() {
        let mut engine = TeeEngine::new();
        let attestation = engine.generate_outcome(
            "test-round".to_string(),
            MarketType::EvenOdd,
            OutcomeParams::default()
        ).unwrap();

        // Verify signature
        let secp = Secp256k1::new();
        let message = Message::from_slice(&attestation.inputs_hash).unwrap();
        let signature = secp256k1::ecdsa::Signature::from_compact(&attestation.signature).unwrap();
        let public_key = PublicKey::from_slice(&attestation.public_key).unwrap();

        assert!(secp.verify_ecdsa(&message, &signature, &public_key).is_ok());
    }
}
