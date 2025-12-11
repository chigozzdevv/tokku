use anchor_lang::prelude::*;
use anchor_lang::solana_program::secp256k1_recover::secp256k1_recover;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use sha2::{Digest, Sha256};

declare_id!("EepYTCc1WZMzXLhLrXy2NwKAAJxM1FH6tKfVsRnhwo1U");

const MARKET_SEED: &[u8] = b"market";
const ROUND_SEED: &[u8] = b"round";
const VAULT_SEED: &[u8] = b"vault";
const BET_SEED: &[u8] = b"bet";
const STREAK_SEED: &[u8] = b"streak";
const COMMUNITY_SEED: &[u8] = b"community";
const PATTERN_SEED: &[u8] = b"pattern";
const JACKPOT_POT_SEED: &[u8] = b"jackpot_pot";
const PERMISSION_GROUP_SEED: &[u8] = b"permission_group";

const MIN_LOCK_DURATION: i64 = 5;
const MAX_PREDICTING_DURATION: i64 = 300;

const TEE_PUBKEY: [u8; 65] = [
    0x04, 0x5d, 0x46, 0xd0, 0x70, 0x9c, 0x22, 0xee, 0x95, 0x23, 0x9e, 0x90, 0x3e, 0xc5, 0xfe, 0x49,
    0x29, 0xc3, 0x21, 0x90, 0x8e, 0xa4, 0xa3, 0x57, 0x87, 0xd2, 0xa5, 0xcf, 0xda, 0x27, 0x5a, 0x51,
    0x16, 0x45, 0x1f, 0x29, 0xb8, 0xcb, 0xff, 0xf2, 0xd5, 0x3f, 0x46, 0xe8, 0xf0, 0xe6, 0x71, 0x8c,
    0x0d, 0xa8, 0x4e, 0x69, 0x56, 0xf6, 0xbe, 0xf9, 0x1f, 0xc9, 0xbc, 0x7f, 0x0a, 0x3e, 0xe9, 0xb4,
    0x05,
];

#[ephemeral]
#[program]
pub mod tokku_engine {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_index: u16,
        name: String,
        house_edge_bps: u16,
        market_type: MarketType,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.admin = ctx.accounts.admin.key();
        market.name = name;
        market.is_active = true;
        market.last_round = 0;
        market.house_edge_bps = house_edge_bps;
        market.mint = ctx.accounts.mint.key();
        market.market_type = market_type;
        market.index = market_index;
        Ok(())
    }

    /// Request VRF randomness inside ER; callback will set outcome.
    pub fn request_randomness(ctx: Context<VrfRequestCtx>, client_seed: u8) -> Result<()> {
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: ID,
        callback_discriminator: instruction::VrfCallback::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.market.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.round.key(),
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback executed inside ER, sets the outcome based on randomness
    pub fn vrf_callback(ctx: Context<VrfCallbackCtx>, randomness: [u8; 32]) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        round.inputs_hash = randomness;
        Ok(())
    }

    pub fn toggle_market(ctx: Context<ToggleMarket>, is_active: bool) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        ctx.accounts.market.is_active = is_active;
        Ok(())
    }

    pub fn set_house_edge_bps(ctx: Context<SetHouseEdge>, house_edge_bps: u16) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        ctx.accounts.market.house_edge_bps = house_edge_bps;
        Ok(())
    }

    pub fn open_round(ctx: Context<OpenRound>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.is_active, ErrorCode::MarketInactive);
        require_keys_eq!(
            market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );

        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;

        market.last_round = market.last_round.saturating_add(1);
        round.market = market.key();
        round.number = market.last_round;
        round.status = RoundStatus::Predicting as u8;
        round.inputs_hash = [0u8; 32];
        round.outcome = OutcomeType::Pending;
        round.unsettled_bets = 0;
        round.opened_at = clock.unix_timestamp;
        round.lock_scheduled_at = 0;
        round.locked_at = 0;
        round.commitment_hash = None;
        round.revealed_at = 0;
        Ok(())
    }

    pub fn schedule_lock(ctx: Context<ScheduleLock>, lock_at: i64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Predicting as u8,
            ErrorCode::InvalidState
        );

        let clock = Clock::get()?;
        require!(lock_at > clock.unix_timestamp, ErrorCode::InvalidLockTime);
        require!(
            lock_at <= round.opened_at + MAX_PREDICTING_DURATION,
            ErrorCode::LockTimeTooLate
        );

        round.lock_scheduled_at = lock_at;
        Ok(())
    }

    pub fn lock_round(ctx: Context<LockRound>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Predicting as u8,
            ErrorCode::InvalidState
        );

        let clock = Clock::get()?;

        if round.lock_scheduled_at > 0 {
            require!(
                clock.unix_timestamp >= round.lock_scheduled_at,
                ErrorCode::LockTimeNotReached
            );
        }

        round.status = RoundStatus::Locked as u8;
        round.locked_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn commit_outcome_hash(
        ctx: Context<CommitOutcome>,
        commitment_hash: [u8; 32],
        attestation_sig: [u8; 64],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= round.locked_at + MIN_LOCK_DURATION,
            ErrorCode::MinLockDurationNotMet
        );

        verify_attestation(&commitment_hash, &attestation_sig)?;

        round.commitment_hash = Some(commitment_hash);
        Ok(())
    }

    pub fn reveal_outcome_numeric(
        ctx: Context<RevealOutcome>,
        value: u16,
        nonce: [u8; 32],
        inputs_hash: [u8; 32],
        attestation_sig: [u8; 64],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.commitment_hash.is_some(), ErrorCode::NoCommitment);

        verify_commitment(
            &round.commitment_hash.unwrap(),
            &value.to_le_bytes(),
            &nonce,
        )?;
        verify_attestation(&round.commitment_hash.unwrap(), &attestation_sig)?;

        let clock = Clock::get()?;
        round.inputs_hash = inputs_hash;
        round.outcome = OutcomeType::Numeric { value };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    /// ER-only: Reveal numeric outcome inside Ephemeral Rollup
    pub fn er_reveal_outcome_numeric(ctx: Context<RevealOutcome>, value: u16) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        let clock = Clock::get()?;
        round.outcome = OutcomeType::Numeric { value };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn reveal_outcome_shape(
        ctx: Context<RevealOutcome>,
        shape: u8,
        color: u8,
        size: u8,
        nonce: [u8; 32],
        inputs_hash: [u8; 32],
        attestation_sig: [u8; 64],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.commitment_hash.is_some(), ErrorCode::NoCommitment);

        let outcome_bytes = [shape, color, size];
        verify_commitment(&round.commitment_hash.unwrap(), &outcome_bytes, &nonce)?;
        // Verify attestation signature against the committed hash (same as commit step)
        verify_attestation(&round.commitment_hash.unwrap(), &attestation_sig)?;

        let clock = Clock::get()?;
        round.inputs_hash = inputs_hash;
        round.outcome = OutcomeType::Shape { shape, color, size };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    /// ER-only: Reveal shape outcome inside Ephemeral Rollup
    pub fn er_reveal_outcome_shape(
        ctx: Context<RevealOutcome>,
        shape: u8,
        color: u8,
        size: u8,
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        let clock = Clock::get()?;
        round.outcome = OutcomeType::Shape { shape, color, size };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn reveal_outcome_pattern(
        ctx: Context<RevealOutcome>,
        pattern_id: u8,
        matched_value: u16,
        nonce: [u8; 32],
        inputs_hash: [u8; 32],
        attestation_sig: [u8; 64],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.commitment_hash.is_some(), ErrorCode::NoCommitment);

        let mut outcome_bytes = vec![pattern_id];
        outcome_bytes.extend_from_slice(&matched_value.to_le_bytes());
        verify_commitment(&round.commitment_hash.unwrap(), &outcome_bytes, &nonce)?;
        // Verify attestation signature against the committed hash (same as commit step)
        verify_attestation(&round.commitment_hash.unwrap(), &attestation_sig)?;

        let clock = Clock::get()?;
        round.inputs_hash = inputs_hash;
        round.outcome = OutcomeType::Pattern {
            pattern_id,
            matched_value,
        };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    /// ER-only: Reveal pattern outcome inside Ephemeral Rollup
    pub fn er_reveal_outcome_pattern(
        ctx: Context<RevealOutcome>,
        pattern_id: u8,
        matched_value: u16,
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        let clock = Clock::get()?;
        round.outcome = OutcomeType::Pattern {
            pattern_id,
            matched_value,
        };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn reveal_outcome_entropy(
        ctx: Context<RevealOutcome>,
        tee_score: u16,
        chain_score: u16,
        sensor_score: u16,
        nonce: [u8; 32],
        inputs_hash: [u8; 32],
        attestation_sig: [u8; 64],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.commitment_hash.is_some(), ErrorCode::NoCommitment);

        let mut outcome_bytes = Vec::new();
        outcome_bytes.extend_from_slice(&tee_score.to_le_bytes());
        outcome_bytes.extend_from_slice(&chain_score.to_le_bytes());
        outcome_bytes.extend_from_slice(&sensor_score.to_le_bytes());
        verify_commitment(&round.commitment_hash.unwrap(), &outcome_bytes, &nonce)?;
        // Verify attestation signature against the committed hash (same as commit step)
        verify_attestation(&round.commitment_hash.unwrap(), &attestation_sig)?;

        let winner = determine_entropy_winner(tee_score, chain_score, sensor_score);
        let clock = Clock::get()?;
        round.inputs_hash = inputs_hash;
        round.outcome = OutcomeType::Entropy {
            tee_score,
            chain_score,
            sensor_score,
            winner,
        };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    /// ER-only: Reveal entropy outcome inside Ephemeral Rollup
    pub fn er_reveal_outcome_entropy(
        ctx: Context<RevealOutcome>,
        tee_score: u16,
        chain_score: u16,
        sensor_score: u16,
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        let winner = determine_entropy_winner(tee_score, chain_score, sensor_score);
        let clock = Clock::get()?;
        round.outcome = OutcomeType::Entropy {
            tee_score,
            chain_score,
            sensor_score,
            winner,
        };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn reveal_outcome_community(
        ctx: Context<RevealOutcome>,
        final_byte: u8,
        seed_hash: [u8; 32],
        nonce: [u8; 32],
        inputs_hash: [u8; 32],
        attestation_sig: [u8; 64],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.commitment_hash.is_some(), ErrorCode::NoCommitment);

        let mut outcome_bytes = vec![final_byte];
        outcome_bytes.extend_from_slice(&seed_hash);
        verify_commitment(&round.commitment_hash.unwrap(), &outcome_bytes, &nonce)?;
        // Verify attestation signature against the committed hash (same as commit step)
        verify_attestation(&round.commitment_hash.unwrap(), &attestation_sig)?;

        let clock = Clock::get()?;
        round.inputs_hash = inputs_hash;
        round.outcome = OutcomeType::Community {
            final_byte,
            seed_hash,
        };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    /// ER-only: Reveal community outcome inside Ephemeral Rollup
    pub fn er_reveal_outcome_community(
        ctx: Context<RevealOutcome>,
        final_byte: u8,
        seed_hash: [u8; 32],
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        let clock = Clock::get()?;
        round.outcome = OutcomeType::Community {
            final_byte,
            seed_hash,
        };
        round.revealed_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, selection: Selection, stake: u64) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(
            round.status == RoundStatus::Predicting as u8,
            ErrorCode::InvalidState
        );

        let clock = Clock::get()?;
        if round.lock_scheduled_at > 0 {
            require!(
                clock.unix_timestamp < round.lock_scheduled_at,
                ErrorCode::BettingClosed
            );
        }

        require!(stake > 0, ErrorCode::InvalidStake);

        let odds_bps = compute_odds_bps(&selection, &ctx.accounts.market)?;

        require_keys_eq!(
            ctx.accounts.market.mint,
            ctx.accounts.mint.key(),
            ErrorCode::Unauthorized
        );

        let decimals = ctx.accounts.mint.decimals;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer_checked(cpi_ctx, stake, decimals)?;

        let bet = &mut ctx.accounts.bet;
        bet.user = ctx.accounts.payer.key();
        bet.round = ctx.accounts.round.key();
        bet.stake = stake;
        bet.selection = selection;
        bet.odds_bps = odds_bps;
        bet.settled = false;
        bet.won = false;
        bet.payout = 0;
        bet.placed_at = clock.unix_timestamp;

        let round_mut = &mut ctx.accounts.round;
        round_mut.unsettled_bets = round_mut.unsettled_bets.saturating_add(1);
        Ok(())
    }

    pub fn delegate_round(ctx: Context<DelegateRound>) -> Result<()> {
        let validator = ctx.remaining_accounts.first().map(|acc| acc.key());

        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[
                ROUND_SEED,
                ctx.accounts.market.key().as_ref(),
                &ctx.accounts.round.number.to_le_bytes(),
            ],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn commit_round(ctx: Context<RoundCommitCtx>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.round.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    pub fn commit_and_undelegate_round(ctx: Context<RoundCommitCtx>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.round.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    pub fn undelegate(ctx: Context<UndelegateRound>, pda_seeds: Vec<Vec<u8>>) -> Result<()> {
        use ephemeral_rollups_sdk::cpi::undelegate_account;

        undelegate_account(
            &ctx.accounts.pda,
            ctx.program_id,
            &ctx.accounts.delegation_buffer,
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            pda_seeds,
        )?;
        Ok(())
    }

    pub fn settle_round(ctx: Context<SettleRound>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.revealed_at > 0, ErrorCode::OutcomeNotRevealed);
        require!(round.unsettled_bets == 0, ErrorCode::UnsettledBetsRemain);
        round.status = RoundStatus::Settled as u8;
        Ok(())
    }

    pub fn settle_bet(ctx: Context<SettleBet>) -> Result<()> {
        let round = &ctx.accounts.round;
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.market.mint,
            ctx.accounts.mint.key(),
            ErrorCode::Unauthorized
        );
        require!(
            round.status == RoundStatus::Locked as u8,
            ErrorCode::InvalidState
        );
        require!(round.revealed_at > 0, ErrorCode::OutcomeNotRevealed);

        let bet = &mut ctx.accounts.bet;
        require!(!bet.settled, ErrorCode::AlreadySettled);

        let won = evaluate_winner(&bet.selection, &round.outcome)?;

        let mut payout_amount: u64 = 0;
        if won {
            payout_amount = bet
                .stake
                .checked_mul(bet.odds_bps as u64)
                .ok_or(ErrorCode::Overflow)?
                / 100u64;
        }

        if payout_amount > 0 {
            let decimals = ctx.accounts.mint.decimals;
            let market_key = ctx.accounts.market.key();
            let seeds = &[VAULT_SEED, market_key.as_ref()];
            let (_vault_pda, bump) = Pubkey::find_program_address(seeds, ctx.program_id);
            let signer_slice: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[bump]];
            let signer_seeds: &[&[&[u8]]] = &[&signer_slice];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer_checked(cpi_ctx, payout_amount, decimals)?;
        }

        bet.settled = true;
        bet.won = won;
        bet.payout = payout_amount;

        let round_mut = &mut ctx.accounts.round;
        round_mut.unsettled_bets = round_mut.unsettled_bets.saturating_sub(1);
        Ok(())
    }

    pub fn init_vault(_ctx: Context<InitVault>) -> Result<()> {
        Ok(())
    }

    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidStake);

        require_keys_eq!(ctx.accounts.market.admin, ctx.accounts.admin.key(), ErrorCode::Unauthorized);
        require_keys_eq!(ctx.accounts.market.mint, ctx.accounts.mint.key(), ErrorCode::Unauthorized);

        let decimals = ctx.accounts.mint.decimals;

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.admin_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer_checked(cpi_ctx, amount, decimals)?;

        Ok(())
    }

    pub fn init_streak(ctx: Context<InitStreak>, target: u16) -> Result<()> {
        require!(target >= 2 && target <= 10, ErrorCode::InvalidStreakTarget);

        let streak = &mut ctx.accounts.streak;
        streak.user = ctx.accounts.user.key();
        streak.market = ctx.accounts.market.key();
        streak.target = target;
        streak.current_streak = 0;
        streak.status = StreakStatus::Active as u8;
        streak.last_round = Pubkey::default();
        Ok(())
    }

    pub fn update_streak(ctx: Context<UpdateStreak>, won: bool) -> Result<()> {
        let streak = &mut ctx.accounts.streak;
        require!(
            streak.status == StreakStatus::Active as u8,
            ErrorCode::StreakNotActive
        );

        if won {
            streak.current_streak = streak.current_streak.saturating_add(1);
            streak.last_round = ctx.accounts.round.key();

            if streak.current_streak >= streak.target {
                streak.status = StreakStatus::Completed as u8;
            }
        } else {
            streak.status = StreakStatus::Failed as u8;
        }

        Ok(())
    }

    pub fn claim_streak_reward(ctx: Context<ClaimStreakReward>) -> Result<()> {
        let streak = &ctx.accounts.streak;
        require!(
            streak.status == StreakStatus::Completed as u8,
            ErrorCode::StreakNotCompleted
        );
        require_keys_eq!(
            streak.user,
            ctx.accounts.user.key(),
            ErrorCode::Unauthorized
        );

        let odds_bps = compute_streak_odds(streak.target)?;
        let base_stake = 100_000_000u64;
        let payout = base_stake
            .checked_mul(odds_bps as u64)
            .ok_or(ErrorCode::Overflow)?
            / 100u64;

        let decimals = ctx.accounts.mint.decimals;
        let market_key = ctx.accounts.market.key();
        let seeds = &[VAULT_SEED, market_key.as_ref()];
        let (_vault_pda, bump) = Pubkey::find_program_address(seeds, ctx.program_id);
        let signer_slice: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[&signer_slice];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer_checked(cpi_ctx, payout, decimals)?;

        let streak_mut = &mut ctx.accounts.streak;
        streak_mut.status = StreakStatus::Claimed as u8;

        Ok(())
    }

    pub fn join_community_round(ctx: Context<JoinCommunityRound>, seed_byte: u8) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(
            round.status == RoundStatus::Predicting as u8,
            ErrorCode::RoundNotPredicting
        );

        let clock = Clock::get()?;
        if round.lock_scheduled_at > 0 {
            require!(
                clock.unix_timestamp < round.lock_scheduled_at,
                ErrorCode::BettingClosed
            );
        }

        let community = &mut ctx.accounts.community_entry;
        community.user = ctx.accounts.user.key();
        community.round = round.key();
        community.seed_byte = seed_byte;
        community.distance = None;
        community.won = false;

        Ok(())
    }

    pub fn finalize_community_round(
        ctx: Context<FinalizeCommunityRound>,
        all_seeds: Vec<u8>,
    ) -> Result<()> {
        require!(all_seeds.len() > 0, ErrorCode::NoCommunitySeedsProvided);

        let mut hasher = Sha256::new();
        hasher.update(&all_seeds);
        let hash_result = hasher.finalize();

        let mut seed_hash = [0u8; 32];
        seed_hash.copy_from_slice(&hash_result);

        let final_byte = seed_hash[31];

        let round = &mut ctx.accounts.round;
        round.outcome = OutcomeType::Community {
            final_byte,
            seed_hash,
        };

        Ok(())
    }

    pub fn settle_community_entry(ctx: Context<SettleCommunityEntry>) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(round.revealed_at > 0, ErrorCode::OutcomeNotRevealed);

        let final_byte = match round.outcome {
            OutcomeType::Community { final_byte, .. } => final_byte,
            _ => return Err(ErrorCode::InvalidOutcomeType.into()),
        };

        let entry = &mut ctx.accounts.community_entry;
        let distance = calculate_hamming_distance(entry.seed_byte, final_byte);

        entry.distance = Some(distance);
        entry.won = distance == 0;

        if entry.won {
            let payout = 1_000_000_000u64;
            let decimals = ctx.accounts.mint.decimals;
            let market_key = ctx.accounts.market.key();
            let seeds = &[VAULT_SEED, market_key.as_ref()];
            let (_vault_pda, bump) = Pubkey::find_program_address(seeds, ctx.program_id);
            let signer_slice: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[bump]];
            let signer_seeds: &[&[&[u8]]] = &[&signer_slice];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer_checked(cpi_ctx, payout, decimals)?;
        }

        Ok(())
    }

    pub fn init_jackpot_pot(ctx: Context<InitJackpotPot>) -> Result<()> {
        let pot = &mut ctx.accounts.jackpot_pot;
        pot.market = ctx.accounts.market.key();
        pot.current_pot = 0;
        pot.last_winner = None;
        pot.total_contributed = 0;
        Ok(())
    }

    pub fn contribute_to_jackpot(ctx: Context<ContributeToJackpot>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidStake);

        let decimals = ctx.accounts.mint.decimals;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer_checked(cpi_ctx, amount, decimals)?;

        let pot = &mut ctx.accounts.jackpot_pot;
        pot.current_pot = pot.current_pot.saturating_add(amount);
        pot.total_contributed = pot.total_contributed.saturating_add(amount);

        Ok(())
    }

    pub fn claim_jackpot(ctx: Context<ClaimJackpot>) -> Result<()> {
        let bet = &ctx.accounts.bet;
        require!(bet.won, ErrorCode::BetNotWon);
        require!(bet.settled, ErrorCode::BetNotSettled);

        let pot = &mut ctx.accounts.jackpot_pot;
        let jackpot_amount = pot.current_pot;

        require!(jackpot_amount > 0, ErrorCode::EmptyJackpot);

        let decimals = ctx.accounts.mint.decimals;
        let market_key = ctx.accounts.market.key();
        let seeds = &[VAULT_SEED, market_key.as_ref()];
        let (_vault_pda, bump) = Pubkey::find_program_address(seeds, ctx.program_id);
        let signer_slice: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[&signer_slice];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer_checked(cpi_ctx, jackpot_amount, decimals)?;

        pot.current_pot = 0;
        pot.last_winner = Some(bet.user);

        Ok(())
    }

    pub fn set_pattern_config(
        ctx: Context<SetPatternConfig>,
        pattern_id: u8,
        pattern_type: PatternType,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );

        let config = &mut ctx.accounts.pattern_config;
        config.market = ctx.accounts.market.key();
        config.pattern_id = pattern_id;
        config.pattern_type = pattern_type;
        config.is_active = true;

        Ok(())
    }

    pub fn create_round_permission_group(
        ctx: Context<CreateRoundPermissionGroup>,
        allowed_viewers: Vec<Pubkey>,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );

        let permission_group = &mut ctx.accounts.permission_group;
        permission_group.round = ctx.accounts.round.key();
        permission_group.allowed_viewers = allowed_viewers;
        permission_group.is_private = true;

        Ok(())
    }

    pub fn add_viewer_to_permission_group(
        ctx: Context<UpdatePermissionGroup>,
        viewer: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );

        let permission_group = &mut ctx.accounts.permission_group;
        require!(
            !permission_group.allowed_viewers.contains(&viewer),
            ErrorCode::ViewerAlreadyExists
        );
        require!(
            permission_group.allowed_viewers.len() < 50,
            ErrorCode::MaxViewersReached
        );

        permission_group.allowed_viewers.push(viewer);

        Ok(())
    }

    pub fn remove_viewer_from_permission_group(
        ctx: Context<UpdatePermissionGroup>,
        viewer: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.admin,
            ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );

        let permission_group = &mut ctx.accounts.permission_group;
        permission_group.allowed_viewers.retain(|&v| v != viewer);

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum OutcomeType {
    Pending,
    Numeric {
        value: u16,
    },
    Shape {
        shape: u8,
        color: u8,
        size: u8,
    },
    Pattern {
        pattern_id: u8,
        matched_value: u16,
    },
    Entropy {
        tee_score: u16,
        chain_score: u16,
        sensor_score: u16,
        winner: u8,
    },
    Community {
        final_byte: u8,
        seed_hash: [u8; 32],
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SelectionKind {
    Range = 0,
    Single = 1,
    Parity = 2,
    Digit = 3,
    Modulo = 4,
    Pattern = 5,
    Shape = 6,
    Entropy = 7,
    Streak = 8,
    Community = 9,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub struct Selection {
    pub kind: u8,
    pub a: u16,
    pub b: u16,
    pub c: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RoundStatus {
    Predicting = 0,
    Locked = 1,
    Settled = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StreakStatus {
    Active = 0,
    Completed = 1,
    Failed = 2,
    Claimed = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PatternType {
    Prime,
    Fibonacci,
    PerfectSquare,
    EndsWithSeven,
    Palindrome,
    Even,
    Odd,
}

#[account]
pub struct Market {
    pub admin: Pubkey,
    pub name: String,
    pub is_active: bool,
    pub last_round: u64,
    pub house_edge_bps: u16,
    pub mint: Pubkey,
    pub market_type: MarketType,
    pub index: u16,
}

#[account]
pub struct Round {
    pub market: Pubkey,
    pub number: u64,
    pub status: u8,
    pub inputs_hash: [u8; 32],
    pub outcome: OutcomeType,
    pub unsettled_bets: u32,
    pub opened_at: i64,
    pub lock_scheduled_at: i64,
    pub locked_at: i64,
    pub commitment_hash: Option<[u8; 32]>,
    pub revealed_at: i64,
}

#[account]
pub struct Bet {
    pub user: Pubkey,
    pub round: Pubkey,
    pub stake: u64,
    pub selection: Selection,
    pub odds_bps: u16,
    pub settled: bool,
    pub won: bool,
    pub payout: u64,
    pub placed_at: i64,
}

#[account]
pub struct Streak {
    pub user: Pubkey,
    pub market: Pubkey,
    pub target: u16,
    pub current_streak: u16,
    pub status: u8,
    pub last_round: Pubkey,
}

#[account]
pub struct CommunityEntry {
    pub user: Pubkey,
    pub round: Pubkey,
    pub seed_byte: u8,
    pub distance: Option<u8>,
    pub won: bool,
}

#[account]
pub struct JackpotPot {
    pub market: Pubkey,
    pub current_pot: u64,
    pub last_winner: Option<Pubkey>,
    pub total_contributed: u64,
}

#[account]
pub struct PatternConfig {
    pub market: Pubkey,
    pub pattern_id: u8,
    pub pattern_type: PatternType,
    pub is_active: bool,
}

#[account]
pub struct PermissionGroup {
    pub round: Pubkey,
    pub allowed_viewers: Vec<Pubkey>,
    pub is_private: bool,
}

#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 4 + 64 + 1 + 8 + 2 + 32 + 16 + 2,
        seeds = [MARKET_SEED, admin.key().as_ref(), &market_index.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ToggleMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED, admin.key().as_ref(), &market.index.to_le_bytes()], bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct SetHouseEdge<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED, admin.key().as_ref(), &market.index.to_le_bytes()], bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct OpenRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED, admin.key().as_ref(), &market.index.to_le_bytes()], bump)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 8 + 1 + 32 + 256 + 4 + 8 + 8 + 8 + 33 + 8,
        seeds = [ROUND_SEED, market.key().as_ref(), &market.last_round.saturating_add(1).to_le_bytes()],
        bump,
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ScheduleLock<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct LockRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct CommitOutcome<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct RevealOutcome<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRound<'info> {
    pub payer: Signer<'info>,
    #[account(mut, del)]
    /// CHECK: Delegated PDA validated by the delegation program (`del` macro applies checks)
    pub pda: AccountInfo<'info>,
    pub market: Account<'info, Market>,
    pub round: Account<'info, Round>,
}

#[commit]
#[derive(Accounts)]
pub struct RoundCommitCtx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct UndelegateRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    /// CHECK: Delegated PDA being undelegated via CPI; validated by delegation program
    pub pda: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Delegation buffer account used by delegation program CPI
    pub delegation_buffer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 8 + 8 + 2 + 1 + 1 + 8 + 8,
        seeds = [BET_SEED, round.key().as_ref(), payer.key().as_ref()],
        bump,
    )]
    pub bet: Account<'info, Bet>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = payer,
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleBet<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [BET_SEED, round.key().as_ref(), bet.user.as_ref()], bump)]
    pub bet: Account<'info, Bet>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(address = bet.user)]
    /// CHECK: Address constraint ensures this is the bet.user
    pub user: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = admin,
    )]
    pub admin_token: Account<'info, TokenAccount>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitStreak<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 2 + 2 + 1 + 32,
        seeds = [STREAK_SEED, user.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub streak: Account<'info, Streak>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStreak<'info> {
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [STREAK_SEED, user.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub streak: Account<'info, Streak>,
}

#[derive(Accounts)]
pub struct ClaimStreakReward<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [STREAK_SEED, user.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub streak: Account<'info, Streak>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinCommunityRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 1 + 2 + 1,
        seeds = [COMMUNITY_SEED, round.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub community_entry: Account<'info, CommunityEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeCommunityRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct SettleCommunityEntry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [COMMUNITY_SEED, round.key().as_ref(), community_entry.user.as_ref()],
        bump,
    )]
    pub community_entry: Account<'info, CommunityEntry>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(address = community_entry.user)]
    /// CHECK: Address constraint ensures this is the recorded community_entry.user
    pub user: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitJackpotPot<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 8 + 33 + 8,
        seeds = [JACKPOT_POT_SEED, market.key().as_ref()],
        bump,
    )]
    pub jackpot_pot: Account<'info, JackpotPot>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ContributeToJackpot<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [JACKPOT_POT_SEED, market.key().as_ref()],
        bump,
    )]
    pub jackpot_pot: Account<'info, JackpotPot>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimJackpot<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    pub round: Account<'info, Round>,
    #[account(seeds = [BET_SEED, round.key().as_ref(), user.key().as_ref()], bump)]
    pub bet: Account<'info, Bet>,
    #[account(
        mut,
        seeds = [JACKPOT_POT_SEED, market.key().as_ref()],
        bump,
    )]
    pub jackpot_pot: Account<'info, JackpotPot>,
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    /// CHECK: Program-derived address used as vault authority; seeds verified by Anchor
    pub vault_authority: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetPatternConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + 32 + 1 + 16 + 1,
        seeds = [PATTERN_SEED, market.key().as_ref()],
        bump,
    )]
    pub pattern_config: Account<'info, PatternConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateRoundPermissionGroup<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 4 + (32 * 50) + 1,
        seeds = [PERMISSION_GROUP_SEED, round.key().as_ref()],
        bump,
    )]
    pub permission_group: Account<'info, PermissionGroup>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePermissionGroup<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [PERMISSION_GROUP_SEED, round.key().as_ref()],
        bump,
    )]
    pub permission_group: Account<'info, PermissionGroup>,
}

#[vrf]
#[derive(Accounts)]
pub struct VrfRequestCtx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    /// CHECK: default oracle queue address
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct VrfCallbackCtx<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [ROUND_SEED, market.key().as_ref(), &round.number.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Market is inactive")]
    MarketInactive,
    #[msg("Invalid state transition")]
    InvalidState,
    #[msg("Invalid stake")]
    InvalidStake,
    #[msg("Overflow")]
    Overflow,
    #[msg("Bet already settled")]
    AlreadySettled,
    #[msg("Unsettled bets remain")]
    UnsettledBetsRemain,
    #[msg("Invalid streak target")]
    InvalidStreakTarget,
    #[msg("Streak not active")]
    StreakNotActive,
    #[msg("Streak not completed")]
    StreakNotCompleted,
    #[msg("Round not in predicting state")]
    RoundNotPredicting,
    #[msg("No community seeds provided")]
    NoCommunitySeedsProvided,
    #[msg("Invalid outcome type")]
    InvalidOutcomeType,
    #[msg("Bet not won")]
    BetNotWon,
    #[msg("Bet not settled")]
    BetNotSettled,
    #[msg("Empty jackpot")]
    EmptyJackpot,
    #[msg("Invalid attestation")]
    InvalidAttestation,
    #[msg("Invalid lock time")]
    InvalidLockTime,
    #[msg("Lock time too late")]
    LockTimeTooLate,
    #[msg("Lock time not reached")]
    LockTimeNotReached,
    #[msg("Min lock duration not met")]
    MinLockDurationNotMet,
    #[msg("No commitment")]
    NoCommitment,
    #[msg("Invalid commitment")]
    InvalidCommitment,
    #[msg("Outcome not revealed")]
    OutcomeNotRevealed,
    #[msg("Betting closed")]
    BettingClosed,
    #[msg("Viewer already exists")]
    ViewerAlreadyExists,
    #[msg("Max viewers reached")]
    MaxViewersReached,
}

fn verify_attestation(inputs_hash: &[u8; 32], signature: &[u8; 64]) -> Result<()> {
    // Try all possible recovery IDs (0..=3) and accept if any recovers to TEE_PUBKEY.
    let expected_uncompressed_xy = &TEE_PUBKEY[1..65];
    for rid in 0u8..4u8 {
        if let Ok(recovered) = secp256k1_recover(inputs_hash, rid, signature) {
            if recovered.to_bytes() == expected_uncompressed_xy {
                return Ok(());
            }
        }
    }
    Err(ErrorCode::InvalidAttestation.into())
}

fn verify_commitment(commitment: &[u8; 32], outcome: &[u8], nonce: &[u8; 32]) -> Result<()> {
    let mut hasher = Sha256::new();
    hasher.update(outcome);
    hasher.update(nonce);
    let computed_hash = hasher.finalize();

    let mut computed = [0u8; 32];
    computed.copy_from_slice(&computed_hash);

    require!(computed == *commitment, ErrorCode::InvalidCommitment);

    Ok(())
}

fn determine_entropy_winner(tee: u16, chain: u16, sensor: u16) -> u8 {
    if tee > chain && tee > sensor {
        0
    } else if chain > tee && chain > sensor {
        1
    } else {
        2
    }
}

fn calculate_hamming_distance(byte1: u8, byte2: u8) -> u8 {
    let xor = byte1 ^ byte2;
    xor.count_ones() as u8
}

fn u16_from(bytes: &[u8], idx: usize) -> u16 {
    u16::from_le_bytes([bytes[idx % 32], bytes[(idx + 1) % 32]])
}
fn u8_from(bytes: &[u8], idx: usize) -> u8 {
    bytes[idx % 32]
}

fn derive_outcome_from_randomness(mt: MarketType, rnd: &[u8; 32]) -> OutcomeType {
    match mt {
        MarketType::PickRange => {
            let v = (u16_from(rnd, 0) % 100) + 1;
            OutcomeType::Numeric { value: v }
        }
        MarketType::EvenOdd => {
            let v = (u8_from(rnd, 0) % 2) as u16;
            OutcomeType::Numeric { value: v }
        }
        MarketType::LastDigit => {
            let v = (u8_from(rnd, 1) % 10) as u16;
            OutcomeType::Numeric { value: v }
        }
        MarketType::ModuloThree => {
            let v = (u8_from(rnd, 2) % 3) as u16;
            OutcomeType::Numeric { value: v }
        }
        MarketType::PatternOfDay => {
            let val = u16_from(rnd, 3) % 1000;
            let mut pid: u8 = 6;
            if is_prime_u16(val) {
                pid = 0;
            } else if is_fib_u16(val) {
                pid = 1;
            } else if is_square_u16(val) {
                pid = 2;
            } else if (val % 10) == 7 {
                pid = 3;
            } else if is_pal_u16(val) {
                pid = 4;
            } else if (val % 2) == 0 {
                pid = 5;
            }
            OutcomeType::Pattern {
                pattern_id: pid,
                matched_value: val,
            }
        }
        MarketType::ShapeColor => {
            let shape = u8_from(rnd, 4) % 4;
            let color = u8_from(rnd, 5) % 6;
            let size = u8_from(rnd, 6) % 3;
            OutcomeType::Shape { shape, color, size }
        }
        MarketType::Jackpot => {
            let v = (u8_from(rnd, 7) % 100) as u16;
            OutcomeType::Numeric { value: v }
        }
        MarketType::EntropyBattle => {
            let tee = (u16_from(rnd, 8) % 512) + 1;
            let chain = (u16_from(rnd, 10) % 512) + 1;
            let sensor = (u16_from(rnd, 12) % 512) + 1;
            let winner = determine_entropy_winner(tee, chain, sensor);
            OutcomeType::Entropy {
                tee_score: tee,
                chain_score: chain,
                sensor_score: sensor,
                winner,
            }
        }
        MarketType::StreakMeter => {
            let v = (u8_from(rnd, 14) % 100) as u16;
            OutcomeType::Numeric { value: v }
        }
        MarketType::CommunitySeed => {
            let final_byte = u8_from(rnd, 15);
            let mut sh = [0u8; 32];
            sh.copy_from_slice(rnd);
            OutcomeType::Community {
                final_byte,
                seed_hash: sh,
            }
        }
    }
}

fn is_prime_u16(n: u16) -> bool {
    if n < 2 {
        return false;
    }
    if n == 2 {
        return true;
    }
    if n % 2 == 0 {
        return false;
    }
    let mut i = 3u16;
    while (i as u32) * (i as u32) <= (n as u32) {
        if n % i == 0 {
            return false;
        }
        i += 2;
    }
    true
}
fn is_square_u16(n: u16) -> bool {
    let r = (n as f64).sqrt() as u16;
    r * r == n
}
fn is_pal_u16(n: u16) -> bool {
    let s = itoa::Buffer::new().format(n).to_string();
    s.chars().rev().collect::<String>() == s
}
fn is_fib_u16(n: u16) -> bool {
    // quick check from precomputed small fibs up to 987
    matches!(
        n,
        0 | 1 | 2 | 3 | 5 | 8 | 13 | 21 | 34 | 55 | 89 | 144 | 233 | 377 | 610 | 987
    )
}

fn compute_streak_odds(target: u16) -> Result<u16> {
    let base_odds = 200u16;
    let multiplier = match target {
        2 => 3,
        3 => 7,
        4 => 12,
        5 => 20,
        6 => 32,
        7 => 50,
        8 => 75,
        9 => 100,
        10 => 150,
        _ => 2,
    };
    Ok(base_odds * multiplier / 10)
}

/// Compute odds as a percent multiplier (e.g. 150 => 1.5x)
/// using real bookmaking economics:
/// - For mutually exclusive equal bins (N), M = N / (1 + edge)
/// - For general probability p, M = (1 / p) / (1 + edge)
/// Where edge = market.house_edge_bps / 10_000. Returned value is M * 100.
fn compute_odds_bps(sel: &Selection, market: &Market) -> Result<u16> {
    let market_type = market.market_type;
    let edge_bps: u64 = (market.house_edge_bps as u64).min(10_000);
    let denom: u64 = 10_000 + edge_bps; // 1 + edge in bps

    // helper: from N equal outcomes -> odds_pct
    let from_equal_bins = |n: u64| -> u16 {
        let m_x100 = n.saturating_mul(1_000_000) / denom; // (N * 10000 * 100) / denom
        m_x100.min(u16::MAX as u64) as u16
    };

    // helper: from probability p = num/den -> odds_pct
    let from_probability = |num: u64, den: u64| -> u16 {
        if num == 0 || den == 0 {
            return 0;
        }
        // M*100 = (1/p) * 100 / (1 + edge) = (den/num) * 100 * (10000/denom)
        let m_x100 = den
            .saturating_mul(100)
            .saturating_mul(10_000)
            .saturating_div(num)
            .saturating_div(denom);
        m_x100.min(u16::MAX as u64) as u16
    };

    match market_type {
        MarketType::EvenOdd => {
            // 2 bins
            Ok(from_equal_bins(2))
        }
        MarketType::ModuloThree => Ok(from_equal_bins(3)),
        MarketType::LastDigit => Ok(from_equal_bins(10)),
        MarketType::Jackpot => Ok(from_equal_bins(100)),
        MarketType::EntropyBattle => Ok(from_equal_bins(3)),
        MarketType::PickRange => {
            match sel.kind {
                x if x == SelectionKind::Range as u8 => {
                    let width: u64 = if sel.b >= sel.a {
                        (sel.b - sel.a + 1) as u64
                    } else {
                        0
                    };
                    if width == 0 {
                        return Ok(0);
                    }
                    if 100 % width == 0 {
                        let n = 100u64 / width; // equal partitions
                        Ok(from_equal_bins(n))
                    } else {
                        // generic probability p = width/100
                        Ok(from_probability(width, 100))
                    }
                }
                x if x == SelectionKind::Single as u8 => Ok(from_equal_bins(100)),
                _ => Ok(from_equal_bins(2)),
            }
        }
        MarketType::ShapeColor => {
            // Total combos = 4 * 6 * 3 = 72
            let shapes = if sel.a == 255 { 4 } else { 1 };
            let colors = if sel.b == 255 { 6 } else { 1 };
            let sizes = if sel.c == 255 { 3 } else { 1 };
            let matched: u64 = (shapes * colors * sizes) as u64;
            let total: u64 = 72;
            Ok(from_probability(matched, total))
        }
        MarketType::PatternOfDay => {
            // Precomputed precedence-adjusted counts for 0..=999 as in derive_outcome_from_randomness
            // [Prime, Fib, Square, EndsWith7, Palindrome, Even, Odd]
            let counts: [u64; 7] = [168, 10, 29, 52, 73, 437, 231];
            let pid = sel.a as usize;
            let total: u64 = 1000;
            let p_num = if pid < counts.len() {
                counts[pid]
            } else {
                counts[6]
            };
            Ok(from_probability(p_num, total))
        }
        MarketType::CommunitySeed => {
            // Selection fields: a = chosen byte, b = tolerance (0..8)
            let t: u8 = (sel.b as u8).min(8);
            // p = sum_{k=0..t} C(8,k) / 256
            let mut num: u64 = 0;
            for k in 0..=t {
                num += n_choose_k(8, k as u32) as u64;
            }
            Ok(from_probability(num, 256))
        }
        MarketType::StreakMeter => {
            // Not bet-based here; provide a conservative default (2 bins)
            Ok(from_equal_bins(2))
        }
    }
}

fn n_choose_k(n: u32, k: u32) -> u32 {
    if k > n {
        return 0;
    }
    if k == 0 || k == n {
        return 1;
    }
    let mut k = k.min(n - k);
    let mut numer: u64 = 1;
    let mut denom: u64 = 1;
    for i in 0..k {
        numer = numer.saturating_mul((n - i) as u64);
        denom = denom.saturating_mul((i + 1) as u64);
    }
    (numer / denom) as u32
}

fn evaluate_winner(sel: &Selection, outcome: &OutcomeType) -> Result<bool> {
    match outcome {
        OutcomeType::Numeric { value } => {
            let v = *value;
            let won = match sel.kind {
                x if x == SelectionKind::Single as u8 => v == sel.a,
                x if x == SelectionKind::Range as u8 => v >= sel.a && v <= sel.b,
                x if x == SelectionKind::Parity as u8 => {
                    let even = (v % 2) == 0;
                    let want_even = sel.a == 0;
                    even == want_even
                }
                x if x == SelectionKind::Digit as u8 => (v % 10) == (sel.a % 10),
                x if x == SelectionKind::Modulo as u8 => (v % 3) == (sel.a % 3),
                _ => false,
            };
            Ok(won)
        }
        OutcomeType::Shape { shape, color, size } => {
            if sel.kind != SelectionKind::Shape as u8 {
                return Ok(false);
            }
            let matches = (sel.a == 255 || sel.a == *shape as u16)
                && (sel.b == 255 || sel.b == *color as u16)
                && (sel.c == 255 || sel.c == *size as u16);
            Ok(matches)
        }
        OutcomeType::Pattern {
            pattern_id,
            matched_value,
        } => {
            if sel.kind != SelectionKind::Pattern as u8 {
                return Ok(false);
            }
            Ok(sel.a == *pattern_id as u16 && *matched_value > 0)
        }
        OutcomeType::Entropy { winner, .. } => {
            if sel.kind != SelectionKind::Entropy as u8 {
                return Ok(false);
            }
            Ok(sel.a == *winner as u16)
        }
        OutcomeType::Community { final_byte, .. } => {
            if sel.kind != SelectionKind::Community as u8 {
                return Ok(false);
            }
            let distance = calculate_hamming_distance(sel.a as u8, *final_byte);
            let tolerance = sel.b as u8;
            Ok(distance <= tolerance)
        }
        OutcomeType::Pending => Ok(false),
    }
}

fn is_prime(n: u16) -> bool {
    if n < 2 {
        return false;
    }
    if n == 2 {
        return true;
    }
    if n % 2 == 0 {
        return false;
    }
    let sqrt = (n as f64).sqrt() as u16;
    for i in (3..=sqrt).step_by(2) {
        if n % i == 0 {
            return false;
        }
    }
    true
}

fn is_fibonacci(n: u16) -> bool {
    let fibs: [u16; 17] = [
        0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987,
    ];
    fibs.contains(&n)
}

fn is_perfect_square(n: u16) -> bool {
    let sqrt = (n as f64).sqrt() as u16;
    sqrt * sqrt == n
}

fn ends_with_seven(n: u16) -> bool {
    n % 10 == 7
}

fn is_palindrome(n: u16) -> bool {
    let s = n.to_string();
    s.chars().eq(s.chars().rev())
}

pub fn matches_pattern(value: u16, pattern_type: PatternType) -> bool {
    match pattern_type {
        PatternType::Prime => is_prime(value),
        PatternType::Fibonacci => is_fibonacci(value),
        PatternType::PerfectSquare => is_perfect_square(value),
        PatternType::EndsWithSeven => ends_with_seven(value),
        PatternType::Palindrome => is_palindrome(value),
        PatternType::Even => value % 2 == 0,
        PatternType::Odd => value % 2 == 1,
    }
}
