//! TEST-ONLY PER access/VRF probe. No wagers, payouts, multipliers or money authority.
//! The inspector intentionally reads the private round; this is not operator-blind.
//! Local builds/tests cannot establish hardware privacy or QFS read/write behavior.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi},
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, ACCOUNT_SIGNATURES_FLAG,
            PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
};
use ephemeral_vrf_sdk::{
    anchor::VrfProgram,
    consts::{scoped_vrf_identity, IDENTITY, VRF_PROGRAM_ID},
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

declare_id!("AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va");
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
pub const TEE_QUEUE: Pubkey = pubkey!("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
pub const INITIALIZED: u8 = 0;
pub const PRIVATE_PREPARED: u8 = 1;
pub const PENDING: u8 = 2;
pub const READY: u8 = 3;
pub const REVEALED: u8 = 4;
/// Finite ~49.7 day interval, NOT a guarantee of disabled automatic commits.
pub const PROBE_COMMIT_FREQUENCY_MS: u32 = u32::MAX;

#[ephemeral]
#[program]
pub mod per_probe {
    use super::*;

    pub fn initialize_round(
        ctx: Context<InitializeRound>,
        id: u64,
        players: [Pubkey; 2],
    ) -> Result<()> {
        let inspector = ctx.accounts.inspector.key();
        require!(
            players[0] != players[1]
                && players
                    .iter()
                    .all(|p| *p != inspector && *p != Pubkey::default()),
            ProbeError::InvalidPlayers
        );
        let round = &mut ctx.accounts.round;
        round.inspector = inspector;
        round.players = players;
        round.id = id;
        round.request_tag = round.key().to_bytes();
        round.randomness = [0; 32];
        round.status = INITIALIZED;
        round.bump = ctx.bumps.round;
        // Only account/permission rent: there are no game stakes or payouts.
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.inspector.to_account_info(),
                    to: round.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
        )?;
        Ok(())
    }

    pub fn initialize_receipt(ctx: Context<InitializeReceipt>) -> Result<()> {
        let receipt = &mut ctx.accounts.receipt;
        receipt.round = ctx.accounts.round.key();
        receipt.player = ctx.accounts.player.key();
        receipt.last_nonce = 0;
        receipt.accepted_count = 0;
        receipt.bump = ctx.bumps.receipt;
        Ok(())
    }

    pub fn delegate_round(ctx: Context<DelegateRound>, id: u64) -> Result<()> {
        let info = ctx.accounts.round.to_account_info();
        let data = info.try_borrow_data()?;
        let mut bytes: &[u8] = &data;
        let round = ProbeRound::try_deserialize(&mut bytes)?;
        round.require_inspector(ctx.accounts.inspector.key())?;
        round.require_status(INITIALIZED)?;
        require_eq!(round.id, id, ProbeError::WrongRound);
        let inspector = round.inspector;
        drop(data);
        ctx.accounts.delegate_round(
            &ctx.accounts.inspector,
            &[b"probe", inspector.as_ref(), &id.to_le_bytes()],
            DelegateConfig {
                validator: Some(TEE_VALIDATOR),
                commit_frequency_ms: PROBE_COMMIT_FREQUENCY_MS,
            },
        )?;
        Ok(())
    }

    pub fn delegate_receipt(ctx: Context<DelegateReceipt>) -> Result<()> {
        let info = ctx.accounts.receipt.to_account_info();
        let data = info.try_borrow_data()?;
        let mut bytes: &[u8] = &data;
        let receipt = ProbeReceipt::try_deserialize(&mut bytes)?;
        require_keys_eq!(
            receipt.player,
            ctx.accounts.player.key(),
            ProbeError::WrongPlayer
        );
        require_keys_eq!(
            receipt.round,
            ctx.accounts.round.key(),
            ProbeError::WrongRound
        );
        let round = receipt.round;
        let player = receipt.player;
        drop(data);
        // No permission is created for receipts. Public visibility must still be
        // observed on PER; the absence of an ACL is not a locally proven result.
        ctx.accounts.delegate_receipt(
            &ctx.accounts.player,
            &[b"receipt", round.as_ref(), player.as_ref()],
            DelegateConfig {
                validator: Some(TEE_VALIDATOR),
                commit_frequency_ms: PROBE_COMMIT_FREQUENCY_MS,
            },
        )?;
        Ok(())
    }

    pub fn prepare_private(ctx: Context<PermissionContext>) -> Result<()> {
        ctx.accounts.round.require_status(INITIALIZED)?;
        let round = &ctx.accounts.round;
        let id = round.id.to_le_bytes();
        let bump = [round.bump];
        let seeds: &[&[u8]] = &[b"probe", round.inspector.as_ref(), &id, &bump];
        CreateEphemeralPermissionCpi {
            payer: round.to_account_info(),
            permissioned_account: round.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member {
                    pubkey: round.inspector,
                    flags: TX_LOGS_FLAG
                        | TX_MESSAGE_FLAG
                        | TX_BALANCES_FLAG
                        | ACCOUNT_SIGNATURES_FLAG,
                }],
            },
        }
        .invoke_signed(&[seeds])?;
        ctx.accounts.round.prepare_private()?;
        Ok(())
    }

    pub fn request_probe_randomness(ctx: Context<RequestProbe>) -> Result<()> {
        validate_private_permission(&ctx.accounts.permission, &ctx.accounts.round)?;
        ctx.accounts.round.request()?;
        let round = &ctx.accounts.round;
        let mut args = Vec::with_capacity(40);
        args.extend_from_slice(&round.id.to_le_bytes());
        args.extend_from_slice(&round.request_tag);
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.inspector.key(),
            oracle_queue: TEE_QUEUE,
            callback_program_id: crate::ID,
            callback_discriminator: instruction::ConsumeProbeRandomness::DISCRIMINATOR.to_vec(),
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: round.key(),
                is_signer: false,
                is_writable: true,
            }]),
            caller_seed: round.request_tag,
            callback_args: Some(args),
        });
        let bump = [ctx.bumps.program_identity];
        invoke_signed(
            &ix,
            &[
                ctx.accounts.inspector.to_account_info(),
                ctx.accounts.program_identity.to_account_info(),
                ctx.accounts.oracle_queue.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.slot_hashes.to_account_info(),
                ctx.accounts.vrf_program.to_account_info(),
            ],
            &[&[IDENTITY, &bump]],
        )?;
        Ok(())
    }

    pub fn consume_probe_randomness(
        ctx: Context<ConsumeProbe>,
        randomness: [u8; 32],
        id: u64,
        request_tag: [u8; 32],
    ) -> Result<()> {
        ctx.accounts.round.consume(id, request_tag, randomness)
    }

    pub fn submit_probe(ctx: Context<SubmitProbe>, nonce: u64) -> Result<()> {
        ctx.accounts.round.require_status(READY)?;
        ctx.accounts
            .round
            .require_player(ctx.accounts.player.key())?;
        ctx.accounts.receipt.accept(nonce)
    }

    pub fn reveal_probe(ctx: Context<PermissionContext>) -> Result<()> {
        ctx.accounts.round.require_status(READY)?;
        let round = &ctx.accounts.round;
        let id = round.id.to_le_bytes();
        let bump = [round.bump];
        let seeds: &[&[u8]] = &[b"probe", round.inspector.as_ref(), &id, &bump];
        UpdateEphemeralPermissionCpi {
            payer: round.to_account_info(),
            permissioned_account: round.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            authority: round.to_account_info(),
            authority_is_signer: false,
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[seeds])?;
        ctx.accounts.round.status = REVEALED;
        // No secret logs, return data, commit, undelegation, or payout instruction.
        Ok(())
    }
}

fn validate_private_permission(
    permission: &UncheckedAccount,
    round: &Account<ProbeRound>,
) -> Result<()> {
    require_keys_eq!(
        *permission.owner,
        PERMISSION_PROGRAM_ID,
        ProbeError::WrongPermission
    );
    let data = permission.try_borrow_data()?;
    let acl =
        EphemeralPermission::from_bytes(&data).map_err(|_| error!(ProbeError::WrongPermission))?;
    require_keys_eq!(
        acl.permissioned_account,
        round.key(),
        ProbeError::WrongPermission
    );
    require!(acl.private, ProbeError::NotPrivate);
    require!(
        !acl.members
            .iter()
            .any(|member| round.players.contains(&member.pubkey)),
        ProbeError::PlayerHasReadMembership
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct InitializeRound<'info> {
    #[account(mut)]
    pub inspector: Signer<'info>,
    #[account(init, payer = inspector, space = 8 + ProbeRound::SIZE, seeds = [b"probe", inspector.key().as_ref(), &id.to_le_bytes()], bump)]
    pub round: Account<'info, ProbeRound>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeReceipt<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"probe", round.inspector.as_ref(), &round.id.to_le_bytes()], bump = round.bump,
        constraint = round.status == INITIALIZED @ ProbeError::WrongState,
        constraint = round.players.contains(&player.key()) @ ProbeError::WrongPlayer)]
    pub round: Account<'info, ProbeRound>,
    #[account(init, payer = player, space = 8 + ProbeReceipt::SIZE, seeds = [b"receipt", round.key().as_ref(), player.key().as_ref()], bump)]
    pub receipt: Account<'info, ProbeReceipt>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct DelegateRound<'info> {
    #[account(mut)]
    pub inspector: Signer<'info>,
    /// CHECK: PDA, owner and deserialized inspector/status/id checked before delegation CPI.
    #[account(mut, del, owner = crate::ID, seeds = [b"probe", inspector.key().as_ref(), &id.to_le_bytes()], bump)]
    pub round: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateReceipt<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Only the key seeds the receipt; its bound round is checked in receipt data.
    pub round: UncheckedAccount<'info>,
    /// CHECK: PDA, owner and deserialized player/round checked before delegation CPI.
    #[account(mut, del, owner = crate::ID, seeds = [b"receipt", round.key().as_ref(), player.key().as_ref()], bump)]
    pub receipt: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PermissionContext<'info> {
    #[account(mut)]
    pub inspector: Signer<'info>,
    #[account(mut, has_one = inspector, seeds = [b"probe", round.inspector.as_ref(), &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, ProbeRound>,
    /// CHECK: The ACL program validates its own canonical permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, round.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Pinned ACL program ID.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Pinned ephemeral rent vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Pinned Magic program ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequestProbe<'info> {
    #[account(mut)]
    pub inspector: Signer<'info>,
    #[account(mut, has_one = inspector, seeds = [b"probe", round.inspector.as_ref(), &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, ProbeRound>,
    /// CHECK: Owner, canonical PDA, private flag and player exclusion are checked.
    #[account(seeds = [PERMISSION_SEED, round.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Exact devnet ephemeral queue; no automatic public-L1 fallback.
    #[account(mut, address = TEE_QUEUE, owner = VRF_PROGRAM_ID)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: This program's canonical request identity signs the VRF CPI.
    #[account(seeds = [IDENTITY], bump)]
    pub program_identity: UncheckedAccount<'info>,
    pub vrf_program: Program<'info, VrfProgram>,
    /// CHECK: Canonical slot-hashes sysvar.
    #[account(address = ephemeral_vrf_sdk::compat::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConsumeProbe<'info> {
    #[account(address = scoped_vrf_identity(&crate::ID))]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut, seeds = [b"probe", round.inspector.as_ref(), &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, ProbeRound>,
}

#[derive(Accounts)]
pub struct SubmitProbe<'info> {
    pub player: Signer<'info>,
    // Deliberately read-only and private. Client must provide this meta directly,
    // without Anchor resolving seeds by reading this account via player auth.
    #[account(seeds = [b"probe", round.inspector.as_ref(), &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, ProbeRound>,
    #[account(mut, has_one = round, has_one = player,
        seeds = [b"receipt", round.key().as_ref(), player.key().as_ref()], bump = receipt.bump)]
    pub receipt: Account<'info, ProbeReceipt>,
}

#[account]
#[derive(Debug)]
pub struct ProbeRound {
    pub inspector: Pubkey,
    pub players: [Pubkey; 2],
    pub id: u64,
    pub request_tag: [u8; 32],
    pub randomness: [u8; 32],
    pub status: u8,
    pub bump: u8,
}
impl ProbeRound {
    pub const SIZE: usize = 32 + 64 + 8 + 32 + 32 + 1 + 1;
    pub fn require_inspector(&self, inspector: Pubkey) -> Result<()> {
        require_keys_eq!(self.inspector, inspector, ProbeError::WrongInspector);
        Ok(())
    }
    pub fn require_player(&self, player: Pubkey) -> Result<()> {
        require!(self.players.contains(&player), ProbeError::WrongPlayer);
        Ok(())
    }
    pub fn require_status(&self, status: u8) -> Result<()> {
        require_eq!(self.status, status, ProbeError::WrongState);
        Ok(())
    }
    pub fn prepare_private(&mut self) -> Result<()> {
        self.require_status(INITIALIZED)?;
        self.status = PRIVATE_PREPARED;
        Ok(())
    }
    pub fn request(&mut self) -> Result<()> {
        self.require_status(PRIVATE_PREPARED)?;
        self.status = PENDING;
        Ok(())
    }
    pub fn consume(&mut self, id: u64, tag: [u8; 32], randomness: [u8; 32]) -> Result<()> {
        self.require_status(PENDING)?;
        require_eq!(self.id, id, ProbeError::WrongRound);
        require!(self.request_tag == tag, ProbeError::WrongRequest);
        self.randomness = randomness;
        self.status = READY;
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct ProbeReceipt {
    pub round: Pubkey,
    pub player: Pubkey,
    pub last_nonce: u64,
    pub accepted_count: u64,
    pub bump: u8,
}
impl ProbeReceipt {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 1;
    pub fn accept(&mut self, nonce: u64) -> Result<()> {
        let next = self.last_nonce.checked_add(1).ok_or(ProbeError::Overflow)?;
        require_eq!(nonce, next, ProbeError::WrongNonce);
        let count = self
            .accepted_count
            .checked_add(1)
            .ok_or(ProbeError::Overflow)?;
        self.last_nonce = next;
        self.accepted_count = count;
        Ok(())
    }
}

#[error_code]
pub enum ProbeError {
    InvalidPlayers,
    WrongInspector,
    WrongPlayer,
    WrongRound,
    WrongRequest,
    WrongState,
    WrongPermission,
    NotPrivate,
    PlayerHasReadMembership,
    WrongNonce,
    Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn round() -> ProbeRound {
        ProbeRound {
            inspector: Pubkey::new_unique(),
            players: [Pubkey::new_unique(), Pubkey::new_unique()],
            id: 7,
            request_tag: [7; 32],
            randomness: [0; 32],
            status: INITIALIZED,
            bump: 1,
        }
    }
    #[test]
    fn privacy_precedes_request_and_requests_cannot_repeat() {
        let mut r = round();
        assert!(r.request().is_err());
        assert_eq!(r.status, INITIALIZED);
        r.prepare_private().unwrap();
        r.request().unwrap();
        assert!(r.request().is_err());
        assert!(r.prepare_private().is_err());
        assert_eq!(r.status, PENDING);
    }
    #[test]
    fn callback_binds_round_tag_and_single_pending_state_without_partial_mutation() {
        let mut r = round();
        assert!(r.consume(7, [7; 32], [9; 32]).is_err());
        r.prepare_private().unwrap();
        r.request().unwrap();
        assert!(r.consume(8, [7; 32], [9; 32]).is_err());
        assert!(r.consume(7, [8; 32], [9; 32]).is_err());
        assert_eq!(r.status, PENDING);
        assert_eq!(r.randomness, [0; 32]);
        r.consume(7, [7; 32], [9; 32]).unwrap();
        assert_eq!(r.status, READY);
        assert!(r.consume(7, [7; 32], [2; 32]).is_err());
        assert_eq!(r.randomness, [9; 32]);
        assert!(r.request().is_err());
    }
    #[test]
    fn inspector_and_players_are_distinct_authority_scopes() {
        let r = round();
        assert!(r.require_inspector(r.inspector).is_ok());
        for player in r.players {
            assert!(r.require_player(player).is_ok());
            assert!(r.require_inspector(player).is_err());
        }
        assert!(r.require_player(r.inspector).is_err());
        assert!(r.require_player(Pubkey::new_unique()).is_err());
    }
    #[test]
    fn receipt_replay_skips_and_overflow_do_not_mutate_state() {
        let mut r = ProbeReceipt {
            round: Pubkey::new_unique(),
            player: Pubkey::new_unique(),
            last_nonce: 0,
            accepted_count: 0,
            bump: 1,
        };
        assert!(r.accept(0).is_err());
        assert!(r.accept(2).is_err());
        r.accept(1).unwrap();
        assert!(r.accept(1).is_err());
        assert_eq!((r.last_nonce, r.accepted_count), (1, 1));
        r.accepted_count = u64::MAX;
        assert!(r.accept(2).is_err());
        assert_eq!(r.last_nonce, 1);
        r.last_nonce = u64::MAX;
        assert!(r.accept(0).is_err());
        assert_eq!(r.last_nonce, u64::MAX);
    }
    #[test]
    fn serialized_account_sizes_and_readonly_round_meta_are_exact() {
        let r = round();
        let mut bytes = Vec::new();
        r.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 8 + ProbeRound::SIZE);
        let player = r.players[0];
        let metas = crate::accounts::SubmitProbe {
            player,
            round: Pubkey::new_unique(),
            receipt: Pubkey::new_unique(),
        }
        .to_account_metas(None);
        assert!(metas[0].is_signer);
        assert!(!metas[1].is_writable);
        assert!(metas[2].is_writable);
        assert_eq!(PROBE_COMMIT_FREQUENCY_MS, u32::MAX);
    }
}
