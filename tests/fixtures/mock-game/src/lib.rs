//! TEST ONLY: signs arbitrary house instructions to exercise the CPI boundary.
//! This deliberately has no game rules or outcome verification. NEVER deploy it
//! to a shared cluster or configure a funded house to trust it.

#[cfg(all(target_os = "solana", not(feature = "test-fixture")))]
compile_error!("mock-game is only a local test fixture; build with --features test-fixture");

use anchor_lang::solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

anchor_lang::declare_id!("4chDssK3K37KdrUDqRZpp8r6ndaH4PxDT1b6XzgaW3WC");
const HOUSE: Pubkey = anchor_lang::pubkey!("9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2");

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (house_program, house_accounts) = accounts
        .split_last()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    if house_program.key != &HOUSE || !house_program.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    let config = house_accounts
        .get(1)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let (authority, bump) =
        Pubkey::find_program_address(&[b"house_authority", config.key.as_ref()], program_id);
    let ix = Instruction {
        program_id: HOUSE,
        accounts: house_accounts
            .iter()
            .map(|account| AccountMeta {
                pubkey: *account.key,
                is_signer: account.is_signer || account.key == &authority,
                is_writable: account.is_writable,
            })
            .collect(),
        data: instruction_data.to_vec(),
    };
    invoke_signed(
        &ix,
        accounts,
        &[&[b"house_authority", config.key.as_ref(), &[bump]]],
    )
}
