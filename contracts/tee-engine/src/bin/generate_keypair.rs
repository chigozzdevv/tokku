use tokku_tee_engine::TeeEngine;
use std::fs;

fn main() {
    let engine = TeeEngine::new();
    let pubkey = engine.get_public_key_bytes();
    
    // Save keypair to file (in production, this would be stored securely)
    let keypair_path = "~/.config/solana/tee-keypair.json";
    println!("⚠️  In production, save secret key securely!");
    println!("For now, TEE engine generates keypair on each startup.\n");
    
    // Print public key for contract
    println!("=== TEE PUBLIC KEY (Add to Contract) ===\n");
    println!("const TEE_PUBKEY: [u8; 65] = [");
    for (i, byte) in pubkey.iter().enumerate() {
        if i % 8 == 0 { print!("    "); }
        print!("0x{:02x}", byte);
        if i < pubkey.len() - 1 { print!(", "); }
        if i % 8 == 7 { println!(); }
    }
    println!("];\n");
    
    // Also print as hex for easy copying
    println!("Hex format:");
    for byte in &pubkey {
        print!("{:02x}", byte);
    }
    println!("\n");
}
