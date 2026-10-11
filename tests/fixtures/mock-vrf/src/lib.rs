//! TEST ONLY: request/callback ABI fixture at MagicBlock's real VRF program ID.
//!
//! It accepts the actual scoped request instruction and only registers requests
//! signed by the requesting program's identity PDA. Anyone may supply arbitrary
//! randomness to its test-only fulfillment instruction: NO proofs are verified.
//! The fixed eight-slot queue is not MagicBlock's production queue layout. TTL,
//! oracle registration, fee collection by an oracle, and network liveness are not
//! simulated. NEVER deploy this fixture to a shared cluster.

#[cfg(all(target_os = "solana", not(feature = "test-fixture")))]
compile_error!("mock-vrf is only a local test fixture; build with --features test-fixture");

use anchor_lang::{
    prelude::{AnchorDeserialize, AnchorSerialize},
    solana_program::{
        account_info::AccountInfo,
        entrypoint::ProgramResult,
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
        program_error::ProgramError,
        pubkey::Pubkey,
    },
    system_program::{self, Transfer},
    ToAccountInfo,
};
use ephemeral_vrf_sdk::{consts, types::RequestRandomness};

anchor_lang::declare_id!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");

#[cfg(not(feature = "no-entrypoint"))]
anchor_lang::solana_program::entrypoint!(process_instruction);

pub const MAX_REQUESTS: usize = 8;
pub const MAX_REQUEST_BYTES: usize = 1024;
pub const QUEUE_SPACE: usize = 8 + MAX_REQUESTS * (2 + MAX_REQUEST_BYTES);
pub const REQUEST_FEE: u64 = 500_000;
pub const FULFILL_DISCRIMINATOR: u8 = 0xfe;
const QUEUE_MAGIC: &[u8; 8] = b"MVRF0001";
const REQUEST_DISCRIMINATOR: [u8; 8] = [10, 0, 0, 0, 0, 0, 0, 0];

pub type Request = RequestRandomness;

/// Public helpers let host tests explicitly inject provider faults into a queue.
#[derive(Debug, PartialEq, AnchorSerialize, AnchorDeserialize)]
pub struct Queue {
    pub requests: Vec<Option<Request>>,
}

impl Default for Queue {
    fn default() -> Self {
        Self {
            requests: (0..MAX_REQUESTS).map(|_| None).collect(),
        }
    }
}

pub fn read_queue(data: &[u8]) -> Result<Queue, ProgramError> {
    if data.len() != QUEUE_SPACE {
        return Err(ProgramError::InvalidAccountData);
    }
    if data.iter().all(|byte| *byte == 0) {
        return Ok(Queue::default());
    }
    if &data[..8] != QUEUE_MAGIC {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut queue = Queue::default();
    for (index, slot) in queue.requests.iter_mut().enumerate() {
        let offset = 8 + index * (2 + MAX_REQUEST_BYTES);
        let len = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
        if len > MAX_REQUEST_BYTES {
            return Err(ProgramError::InvalidAccountData);
        }
        if len > 0 {
            *slot = Some(
                Request::try_from_slice(&data[offset + 2..offset + 2 + len])
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );
        }
    }
    Ok(queue)
}

pub fn write_queue(data: &mut [u8], queue: &Queue) -> ProgramResult {
    if data.len() != QUEUE_SPACE || queue.requests.len() != MAX_REQUESTS {
        return Err(ProgramError::InvalidAccountData);
    }
    data.fill(0);
    data[..8].copy_from_slice(QUEUE_MAGIC);
    for (index, request) in queue.requests.iter().enumerate() {
        if let Some(request) = request {
            let mut bytes = Vec::new();
            request
                .serialize(&mut bytes)
                .map_err(|_| ProgramError::InvalidAccountData)?;
            if bytes.len() > MAX_REQUEST_BYTES {
                return Err(ProgramError::AccountDataTooSmall);
            }
            let offset = 8 + index * (2 + MAX_REQUEST_BYTES);
            data[offset..offset + 2].copy_from_slice(&(bytes.len() as u16).to_le_bytes());
            data[offset + 2..offset + 2 + bytes.len()].copy_from_slice(&bytes);
        }
    }
    Ok(())
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if data.starts_with(&REQUEST_DISCRIMINATOR) {
        request(accounts, &data[8..])
    } else if data.first() == Some(&FULFILL_DISCRIMINATOR) {
        fulfill(accounts, data)
    } else {
        Err(ProgramError::InvalidInstructionData)
    }
}

fn validate_queue(queue: &AccountInfo<'_>) -> ProgramResult {
    if queue.key != &consts::DEFAULT_QUEUE || queue.owner != &ID || !queue.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn request(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [payer, program_identity, oracle_queue, system, slot_hashes] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer.is_signer || !program_identity.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !payer.is_writable
        || system.key != &system_program::ID
        || slot_hashes.key != &ephemeral_vrf_sdk::compat::slot_hashes::ID
    {
        return Err(ProgramError::InvalidAccountData);
    }
    validate_queue(oracle_queue)?;
    let request =
        Request::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    let identity =
        Pubkey::find_program_address(&[consts::IDENTITY], &request.callback_program_id).0;
    if program_identity.key != &identity {
        return Err(ProgramError::InvalidSeeds);
    }
    if data.len() > MAX_REQUEST_BYTES || request.callback_discriminator.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut queue = read_queue(&oracle_queue.try_borrow_data()?)?;
    let slot = queue
        .requests
        .iter()
        .position(Option::is_none)
        .ok_or(ProgramError::AccountDataTooSmall)?;
    queue.requests[slot] = Some(request);
    write_queue(&mut oracle_queue.try_borrow_mut_data()?, &queue)?;
    // A real System Program CPI makes insufficient fee funds fail atomically.
    system_program::transfer(
        anchor_lang::context::CpiContext::new(
            *system.key,
            Transfer {
                from: payer.to_account_info(),
                to: oracle_queue.to_account_info(),
            },
        ),
        REQUEST_FEE,
    )?;
    Ok(())
}

/// Data: 0xfe, slot index (u8), chosen test randomness (32 bytes).
/// Accounts: writable queue, scoped identity, callback program, stored callback accounts.
fn fulfill(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 34 || accounts.len() < 3 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (fixed, callback_accounts) = accounts.split_at(3);
    let [oracle_queue, identity, callback_program] = fixed else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    validate_queue(oracle_queue)?;
    let mut queue = read_queue(&oracle_queue.try_borrow_data()?)?;
    let slot = usize::from(data[1]);
    let request = queue
        .requests
        .get_mut(slot)
        .ok_or(ProgramError::InvalidArgument)?
        .take()
        .ok_or(ProgramError::InvalidAccountData)?;
    if callback_program.key != &request.callback_program_id || !callback_program.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    if callback_accounts.len() != request.callback_accounts_metas.len()
        || callback_accounts
            .iter()
            .zip(&request.callback_accounts_metas)
            .any(|(account, meta)| account.key != &meta.pubkey)
    {
        return Err(ProgramError::InvalidAccountData);
    }
    let (expected_identity, bump) =
        Pubkey::find_program_address(&[consts::IDENTITY, callback_program.key.as_ref()], &ID);
    if identity.key != &expected_identity {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut metas = vec![AccountMeta::new_readonly(expected_identity, true)];
    metas.extend(
        request
            .callback_accounts_metas
            .iter()
            .map(|meta| AccountMeta {
                pubkey: meta.pubkey,
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            }),
    );
    let mut callback_data = request.callback_discriminator;
    callback_data.extend_from_slice(&data[2..34]);
    callback_data.extend_from_slice(&request.callback_args);
    let ix = Instruction {
        program_id: *callback_program.key,
        accounts: metas,
        data: callback_data,
    };
    // Match the real provider: remove before CPI. A failed callback rolls back
    // this write, so the same registered request remains available for retry.
    write_queue(&mut oracle_queue.try_borrow_mut_data()?, &queue)?;
    let mut cpi_accounts = vec![callback_program.clone(), identity.clone()];
    cpi_accounts.extend_from_slice(callback_accounts);
    invoke_signed(
        &ix,
        &cpi_accounts,
        &[&[consts::IDENTITY, callback_program.key.as_ref(), &[bump]]],
    )
}
