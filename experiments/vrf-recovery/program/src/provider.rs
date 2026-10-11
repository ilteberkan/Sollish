//! Source-pinned provider CPI experiment; fixed public fixture keys, no deployment.
use super::{
    capture, checked_snapshot, fail, ID, MAGIC, RANDOMNESS_OFFSET, STATUS_OFFSET, TEST_AUTHORITY,
};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    hash::hash,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    sysvar::{
        self,
        instructions::{load_current_index_checked, load_instruction_at_checked},
        Sysvar,
    },
};
use solana_vrf_api::{
    instruction::RequestRandomness,
    state::{
        oracle_data_pda, oracle_queue_pda, scoped_identity_pda, CompactAccountMeta,
        SerializableAccountMeta,
    },
};

// Public fixture Ed25519 seed [42;32], separate from the VRF Ristretto secret.
pub const TEST_ORACLE_IDENTITY: Pubkey = pubkey!("2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ");
pub const CALLBACK_DISCRIMINATOR: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];

pub fn callback_accounts() -> [CompactAccountMeta; 3] {
    [
        CompactAccountMeta {
            pubkey: super::snapshot_address().to_bytes(),
            is_writable: 1,
        },
        CompactAccountMeta {
            pubkey: oracle_data_pda(&TEST_ORACLE_IDENTITY).0.to_bytes(),
            is_writable: 0,
        },
        CompactAccountMeta {
            pubkey: sysvar::instructions::ID.to_bytes(),
            is_writable: 0,
        },
    ]
}

pub fn admit(accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    if data != [2] || accounts.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let snapshot = checked_snapshot(accounts)?;
    let [_, payer, identity, queue, oracle, slots, system, vrf] = accounts else {
        unreachable!()
    };
    let (caller_identity, bump) = Pubkey::find_program_address(&[b"identity"], &ID);
    if payer.key != &TEST_AUTHORITY || !payer.is_signer || !payer.is_writable {
        return Err(fail(super::ERR_AUTHORITY, "UnauthorizedInitialization"));
    }
    if identity.key != &caller_identity
        || queue.key != &oracle_queue_pda(&TEST_ORACLE_IDENTITY, 0).0
        || !queue.is_writable
        || queue.owner != &solana_vrf_api::ID
        || oracle.key != &oracle_data_pda(&TEST_ORACLE_IDENTITY).0
        || oracle.owner != &solana_vrf_api::ID
        || slots.key != &sysvar::slot_hashes::ID
        || slots.owner != &sysvar::ID
        || system.key != &pubkey!("11111111111111111111111111111111")
        || vrf.key != &solana_vrf_api::ID
        || !vrf.executable
    {
        return Err(ProgramError::InvalidAccountData);
    }
    if snapshot.try_borrow_data()?.iter().any(|b| *b != 0) {
        return Err(fail(super::ERR_INITIALIZED, "SnapshotAlreadyInitialized"));
    }
    let clock = Clock::get()?;
    let slot_hash: [u8; 32] = slots
        .try_borrow_data()?
        .get(16..48)
        .ok_or(ProgramError::UnsupportedSysvar)?
        .try_into()
        .unwrap();
    let seed = snapshot.key.to_bytes();
    let metas = callback_accounts();
    let args = RequestRandomness {
        caller_seed: seed,
        callback_program_id: ID,
        callback_discriminator: CALLBACK_DISCRIMINATOR.to_vec(),
        callback_accounts_metas: metas
            .iter()
            .map(|m| SerializableAccountMeta {
                pubkey: m.pubkey,
                is_signer: false,
                is_writable: m.is_writable == 1,
            })
            .collect(),
        callback_args: seed.to_vec(),
    };
    let mut request = vec![10, 0, 0, 0, 0, 0, 0, 0];
    request.extend(borsh::to_vec(&args).map_err(|_| ProgramError::InvalidInstructionData)?);
    invoke_signed(
        &Instruction {
            program_id: solana_vrf_api::ID,
            accounts: vec![
                AccountMeta::new(*payer.key, true),
                AccountMeta::new_readonly(*identity.key, true),
                AccountMeta::new(*queue.key, false),
                AccountMeta::new_readonly(*system.key, false),
                AccountMeta::new_readonly(*slots.key, false),
            ],
            data: request,
        },
        &[
            payer.clone(),
            identity.clone(),
            queue.clone(),
            system.clone(),
            slots.clone(),
            vrf.clone(),
        ],
        &[&[b"identity", &[bump]]],
    )?;
    // A capture failure rolls back the provider's queue write and request fee too.
    let queue_data = queue.try_borrow_data()?;
    let oracle_data = oracle.try_borrow_data()?;
    let captured = capture::capture_request(
        capture::AccountView {
            key: queue.key,
            owner: queue.owner,
            data: &queue_data,
        },
        capture::AccountView {
            key: oracle.key,
            owner: oracle.owner,
            data: &oracle_data,
        },
        &TEST_ORACLE_IDENTITY,
        &capture::ExpectedRequest {
            callback_program: &ID,
            caller_seed: &seed,
            discriminator: &CALLBACK_DISCRIMINATOR,
            metas: &metas,
            args: &seed,
            slot: clock.slot,
            unix_timestamp: clock.unix_timestamp,
            slot_hash: &slot_hash,
            high_priority: false,
        },
    )
    .map_err(|_| fail(8, "InvalidRequestCapture"))?;
    let mut state = snapshot.try_borrow_mut_data()?;
    state[..8].copy_from_slice(MAGIC);
    state[8..40].copy_from_slice(payer.key.as_ref());
    state[40..72].copy_from_slice(&captured.input);
    state[72..104].copy_from_slice(&captured.oracle_vrf_key);
    state[104..112].copy_from_slice(&captured.request_slot.to_le_bytes());
    state[112..120].copy_from_slice(&captured.created_at.to_le_bytes());
    Ok(())
}

pub fn consume(accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    if accounts.len() != 4 || data.len() != 72 || data[..8] != CALLBACK_DISCRIMINATOR {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [identity, _, oracle, instructions] = accounts else {
        unreachable!()
    };
    let snapshot = checked_snapshot(&accounts[1..])?;
    if identity.key != &scoped_identity_pda(&ID).0
        || !identity.is_signer
        || oracle.key != &oracle_data_pda(&TEST_ORACLE_IDENTITY).0
        || oracle.owner != &solana_vrf_api::ID
        || data[40..] != snapshot.key.to_bytes()
    {
        return Err(ProgramError::InvalidAccountData);
    }
    // Instructions sysvar binds this CPI to a direct provider fulfillment. Wrapper
    // CPIs are intentionally unsupported; they must not bypass this input binding.
    let index = load_current_index_checked(instructions)?;
    let top = load_instruction_at_checked(index as usize, instructions)?;
    if top.program_id != solana_vrf_api::ID
        || top.data.len() != 168
        || top.data[..8] != [4, 0, 0, 0, 0, 0, 0, 0]
        || top.accounts.len() != 8
        || top.accounts[0].pubkey != TEST_ORACLE_IDENTITY
        || !top.accounts[0].is_signer
        || top.accounts[1].pubkey != *identity.key
        || top.accounts[2].pubkey != *oracle.key
        || top.accounts[3].pubkey != oracle_queue_pda(&TEST_ORACLE_IDENTITY, 0).0
        || top.accounts[4].pubkey != ID
    {
        return Err(fail(9, "UnboundProviderCallback"));
    }
    let mut state = snapshot.try_borrow_mut_data()?;
    if &state[..8] != MAGIC || state[8..40] != TEST_AUTHORITY.to_bytes() {
        return Err(fail(super::ERR_UNINITIALIZED, "SnapshotNotInitialized"));
    }
    if state[STATUS_OFFSET] != 0 {
        return Err(fail(super::ERR_CONSUMED, "ProofAlreadyConsumed"));
    }
    let oracle_data = oracle.try_borrow_data()?;
    if oracle_data.len() != 56
        || oracle_data[..8] != [1, 0, 0, 0, 0, 0, 0, 0]
        || oracle_data[8..40] != state[72..104]
        || top.data[8..40] != state[40..72]
        || hash(&top.data[40..72]).as_ref() != &data[8..40]
    {
        return Err(fail(9, "UnboundProviderCallback"));
    }
    state[RANDOMNESS_OFFSET..].copy_from_slice(&data[8..40]);
    state[STATUS_OFFSET] = 1;
    Ok(())
}
