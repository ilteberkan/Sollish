//! NON-PRODUCTION proof recovery experiment. No wagers, payouts or oracle
//! liveness guarantees. The optional provider integration is local VM only.
//! The public fixture authority deliberately cannot secure a deployed program.

#[cfg(all(target_os = "solana", not(feature = "test-fixture")))]
compile_error!("This NON-PRODUCTION experiment requires explicit --features test-fixture");

use solana_curve25519::{
    ristretto::{validate_ristretto, PodRistrettoPoint},
    scalar::PodScalar,
};
use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult, hash::hash, msg,
    program_error::ProgramError, pubkey::Pubkey, sysvar::Sysvar,
};
use solana_vrf_api::verify::verify_vrf;

pub mod capture;
mod provider;
pub use provider::{callback_accounts, CALLBACK_DISCRIMINATOR, TEST_ORACLE_IDENTITY};

pub const ID: Pubkey = Pubkey::new_from_array([91; 32]);
// Public test seed [41; 32]. Never use this authority outside the experiment.
pub const TEST_AUTHORITY: Pubkey = Pubkey::new_from_array([
    250, 72, 52, 20, 127, 110, 105, 12, 54, 147, 239, 246, 19, 54, 4, 100, 3, 205, 138, 226, 161,
    79, 49, 179, 196, 7, 53, 133, 105, 35, 149, 101,
]);
pub const SNAPSHOT_LEN: usize = 153;
pub const MAGIC: &[u8; 8] = b"VRFSNAP1";
pub const STATUS_OFFSET: usize = 120;
pub const RANDOMNESS_OFFSET: usize = 121;
pub const ERR_AUTHORITY: u32 = 1;
pub const ERR_INITIALIZED: u32 = 2;
pub const ERR_UNINITIALIZED: u32 = 3;
pub const ERR_TOO_EARLY: u32 = 4;
pub const ERR_PROOF: u32 = 5;
pub const ERR_CONSUMED: u32 = 6;
pub const ERR_KEY: u32 = 7;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub fn snapshot_address() -> Pubkey {
    Pubkey::find_program_address(&[b"snapshot", TEST_AUTHORITY.as_ref()], &ID).0
}

fn fail(code: u32, message: &str) -> ProgramError {
    msg!("{}", message);
    ProgramError::Custom(code)
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    match data.first() {
        Some(0) => initialize(accounts, data),
        Some(1) => recover(accounts, data),
        Some(2) => provider::admit(accounts, data),
        Some(3) => provider::consume(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn checked_snapshot<'a, 'info>(
    accounts: &'a [AccountInfo<'info>],
) -> Result<&'a AccountInfo<'info>, ProgramError> {
    let snapshot = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if snapshot.key != &snapshot_address() || snapshot.owner != &ID {
        return Err(ProgramError::InvalidAccountData);
    }
    if !snapshot.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    if snapshot.data_len() != SNAPSHOT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(snapshot)
}

fn initialize(accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    if accounts.len() != 2 || data.len() != 65 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let snapshot = checked_snapshot(accounts)?;
    let authority = &accounts[1];
    if authority.key != &TEST_AUTHORITY || !authority.is_signer {
        return Err(fail(ERR_AUTHORITY, "UnauthorizedInitialization"));
    }
    let mut state = snapshot.try_borrow_mut_data()?;
    if state.iter().any(|byte| *byte != 0) {
        return Err(fail(ERR_INITIALIZED, "SnapshotAlreadyInitialized"));
    }
    let key = PodRistrettoPoint(data[33..65].try_into().unwrap());
    if key.0 == [0; 32] || !validate_ristretto(&key) {
        return Err(fail(ERR_KEY, "InvalidOracleKey"));
    }
    let clock = Clock::get()?;
    state[..8].copy_from_slice(MAGIC);
    state[8..40].copy_from_slice(authority.key.as_ref());
    state[40..72].copy_from_slice(&data[1..33]);
    state[72..104].copy_from_slice(&data[33..65]);
    state[104..112].copy_from_slice(&clock.slot.to_le_bytes());
    state[112..120].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
    Ok(())
}

fn recover(accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    if accounts.len() != 1 || data.len() != 129 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let snapshot = checked_snapshot(accounts)?;
    let mut state = snapshot.try_borrow_mut_data()?;
    if &state[..8] != MAGIC || state[8..40] != TEST_AUTHORITY.to_bytes() {
        return Err(fail(ERR_UNINITIALIZED, "SnapshotNotInitialized"));
    }
    if state[STATUS_OFFSET] != 0 {
        return Err(fail(ERR_CONSUMED, "ProofAlreadyConsumed"));
    }
    let request_slot = u64::from_le_bytes(state[104..112].try_into().unwrap());
    let created_at = i64::from_le_bytes(state[112..120].try_into().unwrap());
    let clock = Clock::get()?;
    let eligible_after = created_at
        .checked_add(120)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if clock.slot <= request_slot || clock.unix_timestamp <= eligible_after {
        return Err(fail(ERR_TOO_EARLY, "RecoveryTooEarly"));
    }
    let input: [u8; 32] = state[40..72].try_into().unwrap();
    let key = PodRistrettoPoint(state[72..104].try_into().unwrap());
    let output = PodRistrettoPoint(data[1..33].try_into().unwrap());
    let commitment_base = PodRistrettoPoint(data[33..65].try_into().unwrap());
    let commitment_hash = PodRistrettoPoint(data[65..97].try_into().unwrap());
    let scalar = PodScalar(data[97..129].try_into().unwrap());
    if !verify_vrf(
        &key,
        &input,
        &output,
        (&commitment_base, &commitment_hash, &scalar),
    ) {
        return Err(fail(ERR_PROOF, "InvalidOriginalProof"));
    }
    // Identical to the official provider callback's SHA256(compressed VRF output).
    state[RANDOMNESS_OFFSET..].copy_from_slice(hash(&output.0).as_ref());
    state[STATUS_OFFSET] = 1;
    msg!("OriginalProofRecovered");
    Ok(())
}
