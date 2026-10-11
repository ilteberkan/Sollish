//! LOCAL-VM ONLY scoped-signer capability fixture. Never deploy this program.
//! Tests install it at the provider ID to exercise a real signed CPI. It accepts
//! arbitrary caller bytes and verifies NO VRF proof, request, oracle or privacy.

#[cfg(all(target_os = "solana", not(feature = "test-fixture")))]
compile_error!("local callback fixture requires the explicit test-fixture feature");

use anchor_lang::solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use ephemeral_vrf_sdk::consts::{IDENTITY, VRF_PROGRAM_ID};

#[cfg(not(feature = "no-entrypoint"))]
anchor_lang::solana_program::entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let [callback_program, identity, round] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if program_id != &VRF_PROGRAM_ID || !callback_program.executable || !round.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    let (expected, bump) =
        Pubkey::find_program_address(&[IDENTITY, callback_program.key.as_ref()], program_id);
    if identity.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let callback = Instruction {
        program_id: *callback_program.key,
        accounts: vec![
            AccountMeta::new_readonly(expected, true),
            AccountMeta::new(*round.key, false),
        ],
        data: data.to_vec(),
    };
    invoke_signed(
        &callback,
        &[callback_program.clone(), identity.clone(), round.clone()],
        &[&[IDENTITY, callback_program.key.as_ref(), &[bump]]],
    )
}
