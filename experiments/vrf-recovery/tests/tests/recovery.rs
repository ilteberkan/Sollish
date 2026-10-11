use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT, scalar::Scalar};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_vrf::vrf::compute_vrf;
use std::path::PathBuf;
use vrf_recovery_experiment as experiment;

const INPUT: [u8; 32] = [37; 32];
const SYNTHETIC_QUEUE: Address = Address::new_from_array([88; 32]);

fn program_id() -> Address {
    Address::new_from_array(experiment::ID.to_bytes())
}
fn snapshot() -> Address {
    Address::new_from_array(experiment::snapshot_address().to_bytes())
}
fn oracle_key(secret: u8) -> [u8; 32] {
    (Scalar::from_bytes_mod_order([secret; 32]) * RISTRETTO_BASEPOINT_POINT)
        .compress()
        .to_bytes()
}

/// Actual official host prover, not chosen randomness or a mocked verification result.
fn proof(input: [u8; 32], secret: u8) -> Vec<u8> {
    let (output, (base, hash, scalar)) =
        compute_vrf(Scalar::from_bytes_mod_order([secret; 32]), &input);
    let mut data = vec![1];
    data.extend_from_slice(&output.to_bytes());
    data.extend_from_slice(&base.to_bytes());
    data.extend_from_slice(&hash.to_bytes());
    data.extend_from_slice(&scalar.to_bytes());
    data
}

type Result = std::result::Result<TransactionMetadata, Box<FailedTransactionMetadata>>;

struct Env {
    svm: LiteSVM,
    authority: Keypair,
    submitter: Keypair,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/deploy/vrf_recovery_experiment.so");
        svm.add_program_from_file(program_id(), path)
            .expect("run bash run-local.sh to build SBF");
        let authority = Keypair::new_from_array([41; 32]);
        assert_eq!(
            authority.pubkey().to_bytes(),
            experiment::TEST_AUTHORITY.to_bytes()
        );
        let submitter = Keypair::new();
        assert_ne!(authority.pubkey(), submitter.pubkey());
        for account in [&authority, &submitter] {
            svm.airdrop(&account.pubkey(), 1_000_000_000).unwrap();
        }
        svm.set_account(
            snapshot(),
            Account {
                lamports: svm.minimum_balance_for_rent_exemption(experiment::SNAPSHOT_LEN),
                data: vec![0; experiment::SNAPSHOT_LEN],
                owner: program_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        // Fixture setup only: the experiment deliberately has no account-creation CPI.
        let clock = Clock {
            slot: 100,
            unix_timestamp: 1_000_000,
            ..Clock::default()
        };
        svm.set_sysvar(&clock);
        Self {
            svm,
            authority,
            submitter,
        }
    }

    fn send(&mut self, instruction: Instruction, authority_signs: bool) -> Result {
        self.svm.expire_blockhash();
        let signers = if authority_signs {
            vec![&self.submitter, &self.authority]
        } else {
            vec![&self.submitter]
        };
        let transaction = Transaction::new(
            &signers,
            Message::new(&[instruction], Some(&self.submitter.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(transaction).map_err(Box::new)
    }

    fn initialize(&mut self, input: [u8; 32], key: [u8; 32]) -> Result {
        let mut data = vec![0];
        data.extend_from_slice(&input);
        data.extend_from_slice(&key);
        self.send(
            Instruction {
                program_id: program_id(),
                accounts: vec![
                    AccountMeta::new(snapshot(), false),
                    AccountMeta::new_readonly(self.authority.pubkey(), true),
                ],
                data,
            },
            true,
        )
    }

    fn mature(&mut self) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += 121;
        clock.slot += 400;
        self.svm.set_sysvar(&clock);
    }

    fn recover(&mut self, data: Vec<u8>) -> Result {
        self.send(
            Instruction {
                program_id: program_id(),
                accounts: vec![AccountMeta::new(snapshot(), false)],
                data,
            },
            false,
        )
    }

    fn state(&self) -> Vec<u8> {
        self.svm.get_account(&snapshot()).unwrap().data
    }

    fn reject_proof_without_mutation(&mut self, data: Vec<u8>) {
        let before = self.state();
        assert_error(self.recover(data), "InvalidOriginalProof");
        assert_eq!(self.state(), before);
    }
}

fn assert_error(result: Result, expected: &str) {
    let error = result.expect_err("invalid instruction must fail");
    assert!(
        error.meta.logs.iter().any(|line| line.contains(expected)),
        "expected {expected}, got {error:?}"
    );
}

fn initialized() -> Env {
    let mut env = Env::new();
    env.initialize(INPUT, oracle_key(9)).unwrap();
    env.mature();
    env
}

#[test]
fn original_proof_recovers_after_synthetic_queue_purge() {
    let mut env = Env::new();
    let data = proof(INPUT, 9);
    env.svm
        .set_account(
            SYNTHETIC_QUEUE,
            Account {
                lamports: 1_000_000,
                data: INPUT.to_vec(),
                owner: Address::new_from_array([89; 32]),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    env.initialize(INPUT, oracle_key(9)).unwrap();
    let mut queue = env.svm.get_account(&SYNTHETIC_QUEUE).unwrap();
    queue.data.clear();
    env.svm.set_account(SYNTHETIC_QUEUE, queue).unwrap();
    env.mature();
    let metadata = env.recover(data.clone()).unwrap();
    println!(
        "original_proof_recovery_compute_units={}",
        metadata.compute_units_consumed
    );
    assert!(
        metadata.compute_units_consumed < 300_000,
        "experiment CU budget exceeded"
    );
    let state = env.state();
    assert_eq!(state[experiment::STATUS_OFFSET], 1);
    assert_eq!(
        &state[experiment::RANDOMNESS_OFFSET..],
        solana_program::hash::hash(&data[1..33]).as_ref()
    );
    assert!(env
        .svm
        .get_account(&SYNTHETIC_QUEUE)
        .unwrap()
        .data
        .is_empty());
}

#[test]
fn duplicate_proof_cannot_change_the_recorded_result() {
    let mut env = initialized();
    let data = proof(INPUT, 9);
    env.recover(data.clone()).unwrap();
    let before = env.state();
    assert_error(env.recover(data), "ProofAlreadyConsumed");
    assert_eq!(env.state(), before);
}

#[test]
fn bit_flips_in_each_proof_component_are_rejected() {
    let mut env = initialized();
    let original = proof(INPUT, 9);
    for position in [1, 33, 65, 97] {
        let mut changed = original.clone();
        changed[position] ^= 1;
        env.reject_proof_without_mutation(changed);
    }
    env.recover(original).unwrap();
}

#[test]
fn proof_for_a_different_input_is_rejected() {
    let mut env = initialized();
    env.reject_proof_without_mutation(proof([38; 32], 9));
}

#[test]
fn proof_for_a_different_oracle_key_is_rejected() {
    let mut env = initialized();
    env.reject_proof_without_mutation(proof(INPUT, 10));
}

#[test]
fn output_from_another_valid_proof_is_rejected() {
    let mut env = initialized();
    let mut mixed = proof(INPUT, 9);
    mixed[1..33].copy_from_slice(&proof([38; 32], 9)[1..33]);
    env.reject_proof_without_mutation(mixed);
}

#[test]
fn zero_proof_and_degenerate_oracle_keys_are_rejected() {
    let mut env = Env::new();
    for key in [[0; 32], [255; 32]] {
        assert_error(env.initialize(INPUT, key), "InvalidOracleKey");
        assert_eq!(env.state(), vec![0; experiment::SNAPSHOT_LEN]);
    }
    env.initialize(INPUT, oracle_key(9)).unwrap();
    env.mature();
    let mut zeros = vec![1];
    zeros.extend_from_slice(&[0; 128]);
    env.reject_proof_without_mutation(zeros);
}

#[test]
fn stranger_cannot_initialize_a_snapshot() {
    let mut env = Env::new();
    let mut data = vec![0];
    data.extend_from_slice(&INPUT);
    data.extend_from_slice(&oracle_key(9));
    let instruction = Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(snapshot(), false),
            AccountMeta::new_readonly(env.submitter.pubkey(), true),
        ],
        data,
    };
    assert_error(env.send(instruction, false), "UnauthorizedInitialization");
    assert_eq!(env.state(), vec![0; experiment::SNAPSHOT_LEN]);
}

#[test]
fn authority_cannot_replace_the_original_input_or_key() {
    let mut env = initialized();
    let before = env.state();
    assert_error(
        env.initialize([38; 32], oracle_key(10)),
        "SnapshotAlreadyInitialized",
    );
    assert_eq!(env.state(), before);
    env.recover(proof(INPUT, 9)).unwrap();
    let after = env.state();
    assert_error(
        env.initialize(INPUT, oracle_key(9)),
        "SnapshotAlreadyInitialized",
    );
    assert_eq!(env.state(), after);
}

#[test]
fn caller_cannot_append_replacement_input_or_key_to_recovery() {
    let mut env = initialized();
    let mut data = proof(INPUT, 9);
    data.extend_from_slice(&[38; 32]);
    data.extend_from_slice(&oracle_key(10));
    let before = env.state();
    assert!(env.recover(data).is_err());
    assert_eq!(env.state(), before);
}

#[test]
fn recovery_requires_initialized_snapshot_and_elapsed_gate() {
    let mut env = Env::new();
    let data = proof(INPUT, 9);
    assert_error(env.recover(data.clone()), "SnapshotNotInitialized");
    env.initialize(INPUT, oracle_key(9)).unwrap();
    assert_error(env.recover(data.clone()), "RecoveryTooEarly");
    let mut clock: Clock = env.svm.get_sysvar();
    clock.slot += 400;
    clock.unix_timestamp += 120;
    env.svm.set_sysvar(&clock);
    assert_error(env.recover(data.clone()), "RecoveryTooEarly");
    clock.unix_timestamp += 1;
    env.svm.set_sysvar(&clock);
    env.recover(data).unwrap();
}

#[test]
fn snapshot_binding_rejects_wrong_account_owner() {
    let mut env = initialized();
    let mut state = env.svm.get_account(&snapshot()).unwrap();
    state.owner = Address::new_from_array([92; 32]);
    env.svm.set_account(snapshot(), state).unwrap();
    let before = env.state();
    assert!(env.recover(proof(INPUT, 9)).is_err());
    assert_eq!(env.state(), before);
}

#[test]
fn invalid_encoding_in_each_proof_point_is_rejected() {
    let mut env = initialized();
    let original = proof(INPUT, 9);
    for start in [1, 33, 65] {
        let mut invalid = original.clone();
        invalid[start..start + 32].fill(255);
        env.reject_proof_without_mutation(invalid);
    }
    // Every rejection leaves the authentic proof available for later recovery.
    env.recover(original).unwrap();
}

#[test]
fn response_scalar_equal_to_group_order_is_noncanonical_and_rejected() {
    // Little-endian Ristretto scalar order L = 2^252 +
    // 27742317777372353535851937790883648493. L is not a canonical scalar.
    const ORDER: [u8; 32] = [
        0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde,
        0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
    ];
    assert!(bool::from(Scalar::from_canonical_bytes(ORDER).is_none()));
    let mut env = initialized();
    let original = proof(INPUT, 9);
    let mut invalid = original.clone();
    invalid[97..129].copy_from_slice(&ORDER);
    env.reject_proof_without_mutation(invalid);
    env.recover(original).unwrap();
}

#[test]
fn copied_valid_snapshot_with_correct_owner_cannot_replace_canonical_address() {
    let mut env = initialized();
    let wrong_address = Address::new_from_array([93; 32]);
    assert_ne!(wrong_address, snapshot());
    let original_account = env.svm.get_account(&snapshot()).unwrap();
    assert_eq!(original_account.owner, program_id());
    // Explicit VM fault setup: contents/owner/lamports are all otherwise valid.
    env.svm
        .set_account(wrong_address, original_account.clone())
        .unwrap();
    let instruction = Instruction {
        program_id: program_id(),
        accounts: vec![AccountMeta::new(wrong_address, false)],
        data: proof(INPUT, 9),
    };
    let error = env.send(instruction, false).unwrap_err();
    assert!(format!("{:?}", error.err).contains("InvalidAccountData"));
    assert_eq!(
        env.svm.get_account(&wrong_address),
        Some(original_account.clone())
    );
    assert_eq!(env.svm.get_account(&snapshot()), Some(original_account));
    env.recover(proof(INPUT, 9)).unwrap();
}
