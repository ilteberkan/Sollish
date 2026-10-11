//! Compiled SBF execution, not a PER/QFS/TDX privacy environment.
//! `inject_*` methods are explicit VM-only fault/setup operations. The callback
//! fixture proves signer/PDA checks, never VRF cryptography or oracle behavior.

use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use ephemeral_rollups_sdk::{
    access_control::structs::{EphemeralPermission, PERMISSION_SEED},
    consts::PERMISSION_PROGRAM_ID,
};
use ephemeral_vrf_sdk::consts::{scoped_vrf_identity, IDENTITY, VRF_PROGRAM_ID};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use per_probe::{
    ProbeReceipt, ProbeRound, INITIALIZED, PENDING, PRIVATE_PREPARED, READY, REVEALED, TEE_QUEUE,
};
use solana_account::{Account, ReadableAccount};
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;

const SOL: u64 = 1_000_000_000;
const SYSTEM: Pubkey = anchor_lang::pubkey!("11111111111111111111111111111111");
const ID: u64 = 17;
// Public fixture bytes, not a provider-produced or confidential random value.
const TEST_RANDOMNESS: [u8; 32] = *b"LOCAL_ONLY_RANDOMNESS_FIXTURE_01";
type TxResult = Result<TransactionMetadata, Box<FailedTransactionMetadata>>;

fn addr(value: Pubkey) -> Address {
    Address::new_from_array(value.to_bytes())
}
fn key(value: &Keypair) -> Pubkey {
    Pubkey::new_from_array(value.pubkey().to_bytes())
}
fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: addr(per_probe::ID),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: addr(meta.pubkey),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data: data.data(),
    }
}
fn transaction(
    svm: &mut LiteSVM,
    fee: &Keypair,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> Transaction {
    svm.expire_blockhash();
    let mut all = vec![fee];
    all.extend_from_slice(signers);
    Transaction::new(
        &all,
        Message::new(instructions, Some(&fee.pubkey())),
        svm.latest_blockhash(),
    )
}
fn send(
    svm: &mut LiteSVM,
    fee: &Keypair,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> TxResult {
    let transaction = transaction(svm, fee, instructions, signers);
    svm.send_transaction(transaction).map_err(Box::new)
}
fn error_named(result: TxResult, expected: &str) {
    let error = result.expect_err("invalid transaction must fail");
    assert!(
        error.meta.logs.iter().any(|line| line.contains(expected)),
        "expected {expected}: {error:?}"
    );
}
fn read<T: AccountDeserialize>(svm: &LiteSVM, address: Pubkey) -> T {
    let account = svm.get_account(&addr(address)).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}
fn no_secret_output(metadata: &TransactionMetadata) {
    assert!(metadata.return_data.data.is_empty());
    // This sentinel is only an explicit log regression check, not an information-
    // flow proof. QFS must also filter messages, simulations, accounts and WS.
    let sentinel = std::str::from_utf8(&TEST_RANDOMNESS).unwrap();
    assert!(metadata.logs.iter().all(|line| !line.contains(sentinel)));
}

struct Env {
    svm: LiteSVM,
    fee: Keypair,
    inspector: Keypair,
    players: [Keypair; 2],
    stranger: Keypair,
    round: Pubkey,
    receipts: [Pubkey; 2],
    permission: Pubkey,
}
impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let artifacts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/deploy");
        for (program, name) in [
            (per_probe::ID, "per_probe.so"),
            (VRF_PROGRAM_ID, "per_probe_callback_fixture.so"),
        ] {
            svm.add_program_from_file(addr(program), artifacts.join(name))
                .expect("run runtime-tests/run-local.sh to build local SBF artifacts");
        }
        let fee = Keypair::new();
        let inspector = Keypair::new();
        let players = [Keypair::new(), Keypair::new()];
        let stranger = Keypair::new();
        for wallet in [&fee, &inspector, &players[0], &players[1], &stranger] {
            svm.airdrop(&wallet.pubkey(), 10 * SOL).unwrap();
        }
        let round = Self::round_address(key(&inspector), ID);
        let receipts = players
            .each_ref()
            .map(|player| Self::receipt_address(round, key(player)));
        let permission = Pubkey::find_program_address(
            &[PERMISSION_SEED, round.as_ref()],
            &PERMISSION_PROGRAM_ID,
        )
        .0;
        let mut env = Self {
            svm,
            fee,
            inspector,
            players,
            stranger,
            round,
            receipts,
            permission,
        };
        let initialize = env.initialize_round_ix(ID, env.players.each_ref().map(key));
        send(&mut env.svm, &env.fee, &[initialize], &[&env.inspector]).unwrap();
        for index in 0..2 {
            let initialize = env.initialize_receipt_ix(index);
            send(
                &mut env.svm,
                &env.fee,
                &[initialize],
                &[&env.players[index]],
            )
            .unwrap();
        }
        env
    }
    fn round_address(inspector: Pubkey, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[b"probe", inspector.as_ref(), &id.to_le_bytes()],
            &per_probe::ID,
        )
        .0
    }
    fn receipt_address(round: Pubkey, player: Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[b"receipt", round.as_ref(), player.as_ref()],
            &per_probe::ID,
        )
        .0
    }
    fn initialize_round_ix(&self, id: u64, players: [Pubkey; 2]) -> Instruction {
        ix(
            per_probe::accounts::InitializeRound {
                inspector: key(&self.inspector),
                round: Self::round_address(key(&self.inspector), id),
                system_program: SYSTEM,
            },
            per_probe::instruction::InitializeRound { id, players },
        )
    }
    fn initialize_receipt_ix(&self, index: usize) -> Instruction {
        ix(
            per_probe::accounts::InitializeReceipt {
                player: key(&self.players[index]),
                round: self.round,
                receipt: self.receipts[index],
                system_program: SYSTEM,
            },
            per_probe::instruction::InitializeReceipt {},
        )
    }
    fn submit_ix(&self, index: usize, nonce: u64) -> Instruction {
        ix(
            per_probe::accounts::SubmitProbe {
                player: key(&self.players[index]),
                round: self.round,
                receipt: self.receipts[index],
            },
            per_probe::instruction::SubmitProbe { nonce },
        )
    }
    fn submit(&mut self, index: usize, nonce: u64) -> TxResult {
        let instruction = self.submit_ix(index, nonce);
        send(
            &mut self.svm,
            &self.fee,
            &[instruction],
            &[&self.players[index]],
        )
    }
    fn callback_ix(&self, id: u64, tag: [u8; 32]) -> Instruction {
        ix(
            per_probe::accounts::ConsumeProbe {
                vrf_program_identity: scoped_vrf_identity(&per_probe::ID),
                round: self.round,
            },
            per_probe::instruction::ConsumeProbeRandomness {
                randomness: TEST_RANDOMNESS,
                id,
                request_tag: tag,
            },
        )
    }
    fn fixture_callback_ix(&self, id: u64, tag: [u8; 32]) -> Instruction {
        Instruction {
            program_id: addr(VRF_PROGRAM_ID),
            accounts: vec![
                AccountMeta::new_readonly(addr(per_probe::ID), false),
                AccountMeta::new_readonly(addr(scoped_vrf_identity(&per_probe::ID)), false),
                AccountMeta::new(addr(self.round), false),
            ],
            data: self.callback_ix(id, tag).data,
        }
    }
    fn fixture_callback(&mut self, id: u64, tag: [u8; 32]) -> TxResult {
        let instruction = self.fixture_callback_ix(id, tag);
        send(&mut self.svm, &self.fee, &[instruction], &[])
    }
    fn request_ix(&self) -> Instruction {
        ix(
            per_probe::accounts::RequestProbe {
                inspector: key(&self.inspector),
                round: self.round,
                permission: self.permission,
                oracle_queue: TEE_QUEUE,
                program_identity: Pubkey::find_program_address(&[IDENTITY], &per_probe::ID).0,
                vrf_program: VRF_PROGRAM_ID,
                slot_hashes: ephemeral_vrf_sdk::compat::slot_hashes::ID,
                system_program: SYSTEM,
            },
            per_probe::instruction::RequestProbeRandomness {},
        )
    }
    fn snapshot(&self) -> Vec<Option<Account>> {
        [
            self.round,
            self.receipts[0],
            self.receipts[1],
            self.permission,
            TEE_QUEUE,
            key(&self.inspector),
            key(&self.players[0]),
            key(&self.players[1]),
            key(&self.stranger),
        ]
        .map(|address| self.svm.get_account(&addr(address)))
        .to_vec()
    }
    /// Synthetic VM setup only: neither delegation nor the Permission program runs.
    fn inject_round(&mut self, change: impl FnOnce(&mut ProbeRound)) {
        let mut account = self.svm.get_account(&addr(self.round)).unwrap();
        let mut round: ProbeRound = read(&self.svm, self.round);
        change(&mut round);
        account.data.clear();
        round.try_serialize(&mut account.data).unwrap();
        self.svm.set_account(addr(self.round), account).unwrap();
    }
    /// Synthetic VM account to test our parser/constraints, not a QFS ACL.
    fn inject_permission(&mut self, private: bool, members: &[Pubkey]) {
        let bump = Pubkey::find_program_address(
            &[PERMISSION_SEED, self.round.as_ref()],
            &PERMISSION_PROGRAM_ID,
        )
        .1;
        let mut data = vec![0, bump];
        data.extend_from_slice(self.round.as_ref());
        data.push(u8::from(private));
        for member in members {
            data.push(0);
            data.extend_from_slice(member.as_ref());
        }
        self.svm
            .set_account(
                addr(self.permission),
                Account {
                    lamports: self.svm.minimum_balance_for_rent_exemption(data.len()),
                    data,
                    owner: addr(PERMISSION_PROGRAM_ID),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        self.svm
            .set_account(
                addr(TEE_QUEUE),
                Account {
                    lamports: self.svm.minimum_balance_for_rent_exemption(0),
                    data: vec![],
                    owner: addr(VRF_PROGRAM_ID),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }
}

#[test]
fn actual_sbf_initialization_records_roles_rent_and_distinct_receipts() {
    let env = Env::new();
    let round: ProbeRound = read(&env.svm, env.round);
    assert_eq!(round.inspector, key(&env.inspector));
    assert_eq!(round.players, env.players.each_ref().map(key));
    assert_eq!(
        (round.id, round.status, round.randomness),
        (ID, INITIALIZED, [0; 32])
    );
    assert_eq!(round.request_tag, env.round.to_bytes());
    let account = env.svm.get_account(&addr(env.round)).unwrap();
    assert_eq!(account.owner, addr(per_probe::ID));
    assert_eq!(account.data.len(), 8 + ProbeRound::SIZE);
    assert_eq!(
        account.lamports,
        env.svm
            .minimum_balance_for_rent_exemption(account.data.len())
            + ephemeral_rollups_sdk::ephemeral_accounts::rent(
                EphemeralPermission::size_of(1) as u32
            )
    );
    for index in 0..2 {
        let receipt: ProbeReceipt = read(&env.svm, env.receipts[index]);
        assert_eq!(
            (receipt.round, receipt.player),
            (env.round, key(&env.players[index]))
        );
        assert_eq!((receipt.last_nonce, receipt.accepted_count), (0, 0));
    }
}

#[test]
fn invalid_players_and_missing_initialization_signature_roll_back_account_creation() {
    let mut env = Env::new();
    for players in [
        [key(&env.players[0]); 2],
        [key(&env.inspector), key(&env.players[1])],
        [Pubkey::default(), key(&env.players[1])],
    ] {
        let before = env.snapshot();
        let initialize = env.initialize_round_ix(ID + 1, players);
        error_named(
            send(&mut env.svm, &env.fee, &[initialize], &[&env.inspector]),
            "InvalidPlayers",
        );
        assert_eq!(env.snapshot(), before);
        assert!(env
            .svm
            .get_account(&addr(Env::round_address(key(&env.inspector), ID + 1)))
            .is_none());
    }
    let mut initialize = env.initialize_round_ix(ID + 1, env.players.each_ref().map(key));
    initialize.accounts[0].is_signer = false;
    let before = env.snapshot();
    error_named(
        send(&mut env.svm, &env.fee, &[initialize], &[]),
        "AccountNotSigner",
    );
    assert_eq!(env.snapshot(), before);
}

#[test]
fn receipt_initialization_requires_a_round_player_and_canonical_pdas() {
    let mut env = Env::new();
    let stranger_receipt = Env::receipt_address(env.round, key(&env.stranger));
    let instruction = ix(
        per_probe::accounts::InitializeReceipt {
            player: key(&env.stranger),
            round: env.round,
            receipt: stranger_receipt,
            system_program: SYSTEM,
        },
        per_probe::instruction::InitializeReceipt {},
    );
    let before = env.snapshot();
    error_named(
        send(&mut env.svm, &env.fee, &[instruction], &[&env.stranger]),
        "WrongPlayer",
    );
    assert!(env.svm.get_account(&addr(stranger_receipt)).is_none());
    assert_eq!(env.snapshot(), before);

    let mut bad_round = env.initialize_round_ix(ID + 1, env.players.each_ref().map(key));
    let wrong_address = Env::round_address(key(&env.inspector), ID + 2);
    bad_round.accounts[1].pubkey = addr(wrong_address);
    error_named(
        send(&mut env.svm, &env.fee, &[bad_round], &[&env.inspector]),
        "ConstraintSeeds",
    );
    assert!(env.svm.get_account(&addr(wrong_address)).is_none());
    assert_eq!(env.snapshot(), before);
}

#[test]
fn wallets_cannot_spoof_the_scoped_callback_signer() {
    let mut env = Env::new();
    env.inject_round(|round| round.status = PENDING);
    let before = env.snapshot();
    let mut unsigned = env.callback_ix(ID, env.round.to_bytes());
    unsigned.accounts[0].is_signer = false;
    error_named(
        send(&mut env.svm, &env.fee, &[unsigned], &[]),
        "AccountNotSigner",
    );
    for identity in [key(&env.inspector), key(&env.players[0])] {
        let mut spoof = env.callback_ix(ID, env.round.to_bytes());
        spoof.accounts[0].pubkey = addr(identity);
        let signer = if identity == key(&env.inspector) {
            &env.inspector
        } else {
            &env.players[0]
        };
        error_named(
            send(&mut env.svm, &env.fee, &[spoof], &[signer]),
            "ConstraintAddress",
        );
    }
    assert_eq!(env.snapshot(), before);
}

#[test]
fn real_fixture_cpi_enforces_callback_state_id_tag_and_single_consumption() {
    let mut env = Env::new();
    let before = env.snapshot();
    error_named(env.fixture_callback(ID, env.round.to_bytes()), "WrongState");
    assert_eq!(env.snapshot(), before);
    // Synthetic Pending avoids pretending a real PER request/ACL was executed.
    env.inject_round(|round| round.status = PENDING);
    let before = env.snapshot();
    error_named(
        env.fixture_callback(ID + 1, env.round.to_bytes()),
        "WrongRound",
    );
    assert_eq!(env.snapshot(), before);
    error_named(env.fixture_callback(ID, [89; 32]), "WrongRequest");
    assert_eq!(env.snapshot(), before);
    let metadata = env.fixture_callback(ID, env.round.to_bytes()).unwrap();
    no_secret_output(&metadata);
    let round: ProbeRound = read(&env.svm, env.round);
    assert_eq!((round.status, round.randomness), (READY, TEST_RANDOMNESS));
    let before = env.snapshot();
    error_named(env.fixture_callback(ID, env.round.to_bytes()), "WrongState");
    assert_eq!(env.snapshot(), before);
    // The callback's inner instruction itself contains the randomness. Local
    // execution proves nothing about QFS filtering this RPC surface.
    assert!(metadata
        .inner_instructions
        .iter()
        .flatten()
        .any(|inner| inner
            .instruction
            .data
            .windows(32)
            .any(|bytes| bytes == TEST_RANDOMNESS)));
}

#[test]
fn signed_submit_only_changes_own_receipt_and_rejects_foreign_receipts() {
    let mut env = Env::new();
    env.inject_round(|round| {
        round.status = READY;
        round.randomness = TEST_RANDOMNESS;
    });
    let round_before = env.svm.get_account(&addr(env.round));
    let other_before = env.svm.get_account(&addr(env.receipts[1]));
    let metadata = env.submit(0, 1).unwrap();
    no_secret_output(&metadata);
    assert_eq!(env.svm.get_account(&addr(env.round)), round_before);
    assert_eq!(env.svm.get_account(&addr(env.receipts[1])), other_before);
    let receipt: ProbeReceipt = read(&env.svm, env.receipts[0]);
    assert_eq!((receipt.last_nonce, receipt.accepted_count), (1, 1));
    let before = env.snapshot();
    let mut foreign = env.submit_ix(0, 2);
    foreign.accounts[2].pubkey = addr(env.receipts[1]);
    error_named(
        send(&mut env.svm, &env.fee, &[foreign], &[&env.players[0]]),
        "ConstraintSeeds",
    );
    assert_eq!(env.snapshot(), before);
    let mut unsigned = env.submit_ix(0, 2);
    unsigned.accounts[0].is_signer = false;
    error_named(
        send(&mut env.svm, &env.fee, &[unsigned], &[]),
        "AccountNotSigner",
    );
    assert_eq!(env.snapshot(), before);
    env.submit(1, 1).unwrap();
    assert_eq!(
        read::<ProbeReceipt>(&env.svm, env.receipts[0]).accepted_count,
        1
    );
    assert_eq!(
        read::<ProbeReceipt>(&env.svm, env.receipts[1]).accepted_count,
        1
    );
}

#[test]
fn nonce_and_state_failures_never_reset_or_partially_advance_receipts() {
    let mut env = Env::new();
    for state in [INITIALIZED, PRIVATE_PREPARED, PENDING, REVEALED] {
        env.inject_round(|round| round.status = state);
        let before = env.snapshot();
        error_named(env.submit(0, 1), "WrongState");
        assert_eq!(env.snapshot(), before);
    }
    env.inject_round(|round| round.status = READY);
    env.submit(0, 1).unwrap();
    for nonce in [0, 1, 3] {
        let before = env.snapshot();
        error_named(env.submit(0, nonce), "WrongNonce");
        assert_eq!(env.snapshot(), before);
    }
    env.submit(0, 2).unwrap();
    let before = env.snapshot();
    let initialize = env.initialize_receipt_ix(0);
    let error = send(&mut env.svm, &env.fee, &[initialize], &[&env.players[0]]).unwrap_err();
    assert!(error
        .meta
        .logs
        .iter()
        .any(|line| line.contains("already in use")));
    assert_eq!(env.snapshot(), before);
    // Explicit corruption boundary injection, not an achievable user operation.
    let mut account = env.svm.get_account(&addr(env.receipts[0])).unwrap();
    let mut receipt: ProbeReceipt = read(&env.svm, env.receipts[0]);
    receipt.last_nonce = u64::MAX;
    account.data.clear();
    receipt.try_serialize(&mut account.data).unwrap();
    env.svm.set_account(addr(env.receipts[0]), account).unwrap();
    let before = env.snapshot();
    error_named(env.submit(0, 0), "Overflow");
    assert_eq!(env.snapshot(), before);
}

#[test]
fn request_checks_private_permission_player_exclusion_and_queue_before_cpi() {
    let mut env = Env::new();
    env.inject_round(|round| round.status = PRIVATE_PREPARED);
    for (private, members, expected) in [
        (false, vec![], "NotPrivate"),
        (true, vec![key(&env.players[0])], "PlayerHasReadMembership"),
        (true, vec![key(&env.players[1])], "PlayerHasReadMembership"),
    ] {
        env.inject_permission(private, &members);
        let request = env.request_ix();
        let before = env.snapshot();
        error_named(
            send(&mut env.svm, &env.fee, &[request], &[&env.inspector]),
            expected,
        );
        assert_eq!(env.snapshot(), before);
    }
    env.inject_permission(true, &[key(&env.inspector)]);
    let mut permission = env.svm.get_account(&addr(env.permission)).unwrap();
    permission.owner = addr(SYSTEM);
    env.svm
        .set_account(addr(env.permission), permission)
        .unwrap();
    let before = env.snapshot();
    let request = env.request_ix();
    error_named(
        send(&mut env.svm, &env.fee, &[request], &[&env.inspector]),
        "WrongPermission",
    );
    assert_eq!(env.snapshot(), before);
    env.inject_permission(true, &[key(&env.inspector)]);
    let before = env.snapshot();
    // Give the wrong address the correct provider owner so this exercises the
    // address constraint, not an earlier owner rejection.
    let wrong_queue = Pubkey::new_unique();
    let queue_copy = env.svm.get_account(&addr(TEE_QUEUE)).unwrap();
    env.svm
        .set_account(addr(wrong_queue), queue_copy.clone())
        .unwrap();
    let mut request = env.request_ix();
    request.accounts[3].pubkey = addr(wrong_queue);
    error_named(
        send(&mut env.svm, &env.fee, &[request], &[&env.inspector]),
        "ConstraintAddress",
    );
    assert_eq!(env.snapshot(), before);
    assert_eq!(env.svm.get_account(&addr(wrong_queue)), Some(queue_copy));
    let mut queue = env.svm.get_account(&addr(TEE_QUEUE)).unwrap();
    queue.owner = addr(SYSTEM);
    env.svm.set_account(addr(TEE_QUEUE), queue).unwrap();
    let before = env.snapshot();
    let request = env.request_ix();
    error_named(
        send(&mut env.svm, &env.fee, &[request], &[&env.inspector]),
        "ConstraintOwner",
    );
    assert_eq!(env.snapshot(), before);
    env.inject_permission(true, &[key(&env.inspector)]);
    let before = env.snapshot();
    let request = env.request_ix();
    // Valid synthetic ACL passes our checks and enters the request CPI, which
    // this callback-only fixture deliberately cannot implement. The earlier
    // PrivatePrepared -> Pending write must roll back with the failed CPI.
    let error = send(&mut env.svm, &env.fee, &[request], &[&env.inspector]).unwrap_err();
    assert!(format!("{:?}", error.err).contains("NotEnoughAccountKeys"));
    assert_eq!(env.snapshot(), before);
    assert_eq!(
        read::<ProbeRound>(&env.svm, env.round).status,
        PRIVATE_PREPARED
    );
}

#[test]
fn local_simulation_exposes_account_bytes_and_is_not_a_privacy_test() {
    let mut env = Env::new();
    env.inject_round(|round| {
        round.status = READY;
        round.randomness = TEST_RANDOMNESS;
    });
    let before = env.snapshot();
    let instruction = env.submit_ix(0, 1);
    assert!(!instruction.accounts[1].is_writable);
    let readonly_transaction =
        transaction(&mut env.svm, &env.fee, &[instruction], &[&env.players[0]]);
    let simulation = env.svm.simulate_transaction(readonly_transaction).unwrap();
    no_secret_output(&simulation.meta);
    assert_eq!(env.snapshot(), before);
    let (_, simulated_receipt) = simulation
        .post_accounts
        .iter()
        .find(|(address, _)| *address == addr(env.receipts[0]))
        .unwrap();
    let receipt = ProbeReceipt::try_deserialize(&mut simulated_receipt.data()).unwrap();
    assert_eq!((receipt.last_nonce, receipt.accepted_count), (1, 1));
    assert_eq!(
        read::<ProbeReceipt>(&env.svm, env.receipts[0]).accepted_count,
        0
    );
    // LiteSVM returns only writable post-accounts. A caller may promote a meta
    // to writable even when the IDL asks for read-only; the program still does
    // not modify Round. A production PER ingress must independently enforce its
    // read/write policy and the RPC account-return surface for such a request.
    let mut promoted = env.submit_ix(0, 1);
    promoted.accounts[1].is_writable = true;
    let transaction = transaction(&mut env.svm, &env.fee, &[promoted], &[&env.players[0]]);
    let simulation = env.svm.simulate_transaction(transaction).unwrap();
    let (_, simulated_round) = simulation
        .post_accounts
        .iter()
        .find(|(address, _)| *address == addr(env.round))
        .unwrap();
    let round = ProbeRound::try_deserialize(&mut simulated_round.data()).unwrap();
    assert_eq!(round.randomness, TEST_RANDOMNESS);
    no_secret_output(&simulation.meta);
    assert_eq!(env.snapshot(), before);
}

#[test]
fn changing_a_signed_nonce_is_rejected_by_runtime_signature_verification() {
    let mut env = Env::new();
    env.inject_round(|round| round.status = READY);
    let instruction = env.submit_ix(0, 1);
    let mut signed = transaction(&mut env.svm, &env.fee, &[instruction], &[&env.players[0]]);
    signed.message.instructions[0].data = per_probe::instruction::SubmitProbe { nonce: 2 }.data();
    let before = env.snapshot();
    let error = env.svm.send_transaction(signed).unwrap_err();
    assert!(format!("{:?}", error.err).contains("SignatureFailure"));
    assert_eq!(env.snapshot(), before);
}
