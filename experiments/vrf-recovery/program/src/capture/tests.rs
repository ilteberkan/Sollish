use super::*;
use solana_vrf_api::{consts::RISTRETTO_BASEPOINT_POINT, state::QueueAccount};

const CALLBACK: Pubkey = Pubkey::new_from_array([3; 32]);
const SEED: [u8; 32] = [7; 32];
const SLOT_HASH: [u8; 32] = [9; 32];
const DISC: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
const ARGS: [u8; 32] = [17; 32];
const METAS: [CompactAccountMeta; 2] = [
    CompactAccountMeta {
        pubkey: [11; 32],
        is_writable: 1,
    },
    CompactAccountMeta {
        pubkey: [12; 32],
        is_writable: 0,
    },
];

fn expected() -> ExpectedRequest<'static> {
    ExpectedRequest {
        callback_program: &CALLBACK,
        caller_seed: &SEED,
        discriminator: &DISC,
        metas: &METAS,
        args: &ARGS,
        slot: 100,
        unix_timestamp: 1_000_000,
        slot_hash: &SLOT_HASH,
        high_priority: false,
    }
}

fn request_id(request: &ExpectedRequest<'_>, offset: u32) -> [u8; 32] {
    hashv(&[
        request.caller_seed,
        &request.slot.to_le_bytes(),
        request.slot_hash,
        request.discriminator,
        request.callback_program.as_ref(),
        &request.unix_timestamp.to_le_bytes(),
        &offset.to_le_bytes(),
    ])
    .to_bytes()
}

struct Fixture {
    // Align provider's zero-copy constructor independently of the allocator's
    // usual alignment for Vec<u8>. The capture reader itself needs no alignment.
    queue_words: Vec<u64>,
    oracle_words: [u64; 7],
    identity: Pubkey,
    queue_key: Pubkey,
    oracle_key: Pubkey,
}

impl Fixture {
    fn new() -> Self {
        let identity = crate::TEST_AUTHORITY;
        let index = 4;
        let mut fixture = Self {
            queue_words: vec![0; 512],
            oracle_words: [0; 7],
            identity,
            queue_key: oracle_queue_pda(&identity, index).0,
            oracle_key: oracle_data_pda(&identity).0,
        };
        fixture.queue_mut()[..8].copy_from_slice(&AccountDiscriminator::Queue.to_bytes());
        {
            let view = QueueAccount::load(fixture.queue_mut()).unwrap();
            view.header.index = index;
        }
        let oracle = Oracle {
            vrf_pubkey: RISTRETTO_BASEPOINT_POINT,
            registration_slot: 1,
            open_queues: 1,
        };
        fixture.oracle_mut()[..8].copy_from_slice(&AccountDiscriminator::Oracle.to_bytes());
        fixture.oracle_mut()[8..].copy_from_slice(bytemuck::bytes_of(&oracle));
        fixture
    }

    fn queue(&self) -> &[u8] {
        bytemuck::cast_slice(&self.queue_words)
    }
    fn queue_mut(&mut self) -> &mut [u8] {
        bytemuck::cast_slice_mut(&mut self.queue_words)
    }
    fn oracle(&self) -> &[u8] {
        bytemuck::cast_slice(&self.oracle_words)
    }
    fn oracle_mut(&mut self) -> &mut [u8] {
        bytemuck::cast_slice_mut(&mut self.oracle_words)
    }

    fn add(&mut self, request: &ExpectedRequest<'_>) -> u32 {
        let base = QueueItem {
            slot: request.slot,
            callback_program_id: request.callback_program.to_bytes(),
            priority_request: u8::from(request.high_priority),
            used: 1,
            identity_mode: 1,
            identity_bump: scoped_identity_pda(request.callback_program).1,
            created_at: QueueItem::created_at_from(request.unix_timestamp),
            ..QueueItem::default()
        };
        let mut offset = None;
        QueueAccount::load(self.queue_mut())
            .unwrap()
            .add_item_with_id(
                &base,
                request.discriminator,
                request.metas,
                request.args,
                |position| {
                    offset = Some(position);
                    request_id(request, position)
                },
            )
            .unwrap();
        offset.unwrap()
    }

    fn capture(&self, request: &ExpectedRequest<'_>) -> Result<CapturedRequest, CaptureError> {
        capture_request(
            AccountView {
                key: &self.queue_key,
                owner: &solana_vrf_api::ID,
                data: self.queue(),
            },
            AccountView {
                key: &self.oracle_key,
                owner: &solana_vrf_api::ID,
                data: self.oracle(),
            },
            &self.identity,
            request,
        )
    }

    fn update_item(&mut self, offset: u32, change: impl FnOnce(&mut QueueItem)) {
        let start = 8 + offset as usize;
        let mut item: QueueItem =
            bytemuck::pod_read_unaligned(&self.queue()[start..start + size_of::<QueueItem>()]);
        change(&mut item);
        self.queue_mut()[start..start + size_of::<QueueItem>()]
            .copy_from_slice(bytemuck::bytes_of(&item));
    }
}

#[test]
fn actual_pinned_layout_and_readonly_capture_match_upstream_constructor() {
    assert_eq!(size_of::<Queue>(), 12);
    assert_eq!(size_of::<QueueItem>(), 96);
    assert_eq!(size_of::<CompactAccountMeta>(), 33);
    assert_eq!(size_of::<Oracle>(), 48);
    let mut fixture = Fixture::new();
    let request = expected();
    let offset = fixture.add(&request);
    assert_eq!(offset, 16);
    let before = fixture.queue().to_vec();
    let captured = fixture.capture(&request).unwrap();
    assert_eq!(
        captured,
        CapturedRequest {
            input: request_id(&request, offset),
            oracle_vrf_key: RISTRETTO_BASEPOINT_POINT.0,
            request_slot: request.slot,
            created_at: request.unix_timestamp,
            item_offset: 16,
            queue_index: 4,
        }
    );
    assert_eq!(fixture.queue(), before);
}

#[test]
fn actual_hole_reuse_is_captured_at_its_body_offset() {
    let mut fixture = Fixture::new();
    let first = fixture.add(&expected());
    let foreign_args = [22; 32];
    let foreign = ExpectedRequest {
        args: &foreign_args,
        ..expected()
    };
    let second = fixture.add(&foreign);
    QueueAccount::load(fixture.queue_mut())
        .unwrap()
        .remove_item(0)
        .unwrap();
    let reused = fixture.add(&expected());
    assert_eq!(reused, first);
    assert!(second > first);
    assert_eq!(fixture.capture(&expected()).unwrap().item_offset, first);
}

#[test]
fn upstream_reuse_can_leave_nonzero_alignment_padding() {
    let mut fixture = Fixture::new();
    // 96 + 8 + 66 + 30 and +29 occupy the same aligned 200-byte span.
    let old_args = [0xA5; 30];
    let new_args = [0xB6; 29];
    let old = ExpectedRequest {
        args: &old_args,
        ..expected()
    };
    let new = ExpectedRequest {
        args: &new_args,
        ..expected()
    };
    let offset = fixture.add(&old);
    fixture.add(&expected());
    QueueAccount::load(fixture.queue_mut())
        .unwrap()
        .remove_item(0)
        .unwrap();
    assert_eq!(fixture.add(&new), offset);
    let padding_byte = 8
        + offset as usize
        + size_of::<QueueItem>()
        + DISC.len()
        + size_of::<CompactAccountMeta>() * METAS.len()
        + new_args.len();
    assert_eq!(fixture.queue()[padding_byte], 0xA5);
    assert_eq!(fixture.capture(&new).unwrap().item_offset, offset);
}

#[test]
fn full_discriminators_canonical_pdas_and_owners_are_required() {
    let mut fixture = Fixture::new();
    fixture.add(&expected());
    let foreign = Pubkey::new_from_array([99; 32]);
    let view = |key, owner, data| AccountView { key, owner, data };
    assert_eq!(
        capture_request(
            view(&fixture.queue_key, &foreign, fixture.queue()),
            view(&fixture.oracle_key, &solana_vrf_api::ID, fixture.oracle()),
            &fixture.identity,
            &expected()
        ),
        Err(CaptureError::WrongOwner)
    );
    assert_eq!(
        capture_request(
            view(&fixture.queue_key, &solana_vrf_api::ID, fixture.queue()),
            view(&fixture.oracle_key, &foreign, fixture.oracle()),
            &fixture.identity,
            &expected()
        ),
        Err(CaptureError::WrongOwner)
    );
    assert_eq!(
        capture_request(
            view(&foreign, &solana_vrf_api::ID, fixture.queue()),
            view(&fixture.oracle_key, &solana_vrf_api::ID, fixture.oracle()),
            &fixture.identity,
            &expected()
        ),
        Err(CaptureError::WrongQueueAddress)
    );
    assert_eq!(
        capture_request(
            view(&fixture.queue_key, &solana_vrf_api::ID, fixture.queue()),
            view(&foreign, &solana_vrf_api::ID, fixture.oracle()),
            &fixture.identity,
            &expected()
        ),
        Err(CaptureError::WrongOracleAddress)
    );
    assert_eq!(
        capture_request(
            view(&fixture.queue_key, &solana_vrf_api::ID, fixture.queue()),
            view(&fixture.oracle_key, &solana_vrf_api::ID, fixture.oracle()),
            &foreign,
            &expected()
        ),
        Err(CaptureError::WrongQueueAddress)
    );
    fixture.queue_mut()[7] = 1;
    assert_eq!(
        fixture.capture(&expected()),
        Err(CaptureError::InvalidLayout)
    );
    fixture.queue_mut()[7] = 0;
    fixture.oracle_mut()[7] = 1;
    assert_eq!(
        fixture.capture(&expected()),
        Err(CaptureError::InvalidLayout)
    );
}

#[test]
fn identity_and_malformed_oracle_keys_are_rejected() {
    for bad_key in [[0; 32], [255; 32]] {
        let mut fixture = Fixture::new();
        fixture.add(&expected());
        fixture.oracle_mut()[8..40].copy_from_slice(&bad_key);
        assert_eq!(
            fixture.capture(&expected()),
            Err(CaptureError::InvalidOracleKey)
        );
    }
}

#[test]
fn duplicate_matching_callbacks_are_ambiguous_even_with_distinct_input_ids() {
    let mut fixture = Fixture::new();
    let first = fixture.add(&expected());
    let second = fixture.add(&expected());
    assert_ne!(
        request_id(&expected(), first),
        request_id(&expected(), second)
    );
    assert_eq!(
        fixture.capture(&expected()),
        Err(CaptureError::AmbiguousRequest)
    );
}

#[test]
fn callback_program_discriminator_metas_and_args_must_match_exactly() {
    let mut fixture = Fixture::new();
    fixture.add(&expected());
    let other_callback = Pubkey::new_from_array([4; 32]);
    let other_disc = [4; 8];
    let other_args = [18; 32];
    let mut other_metas = METAS;
    other_metas.swap(0, 1);
    for request in [
        ExpectedRequest {
            callback_program: &other_callback,
            ..expected()
        },
        ExpectedRequest {
            discriminator: &other_disc,
            ..expected()
        },
        ExpectedRequest {
            metas: &other_metas,
            ..expected()
        },
        ExpectedRequest {
            args: &other_args,
            ..expected()
        },
    ] {
        assert_eq!(
            fixture.capture(&request),
            Err(CaptureError::RequestNotFound)
        );
    }
}

#[test]
fn original_input_binds_seed_slothash_timestamp_and_real_byte_offset() {
    let mut fixture = Fixture::new();
    let offset = fixture.add(&expected());
    let other = [20; 32];
    for request in [
        ExpectedRequest {
            caller_seed: &other,
            ..expected()
        },
        ExpectedRequest {
            slot_hash: &other,
            ..expected()
        },
        ExpectedRequest {
            unix_timestamp: expected().unix_timestamp + 1,
            ..expected()
        },
    ] {
        assert_eq!(fixture.capture(&request), Err(CaptureError::InputMismatch));
    }
    fixture.update_item(offset, |item| item.id = request_id(&expected(), offset + 8));
    assert_eq!(
        fixture.capture(&expected()),
        Err(CaptureError::InputMismatch)
    );
}

#[test]
fn slot_priority_scoped_identity_and_creation_stamp_are_bound() {
    let changes: [fn(&mut QueueItem); 5] = [
        |item| item.slot += 1,
        |item| item.priority_request = 1,
        |item| item.identity_mode = 0,
        |item| item.identity_bump ^= 1,
        |item| item.created_at = item.created_at.wrapping_add(1),
    ];
    for change in changes {
        let mut fixture = Fixture::new();
        let offset = fixture.add(&expected());
        fixture.update_item(offset, change);
        assert_eq!(
            fixture.capture(&expected()),
            Err(CaptureError::RequestMismatch)
        );
    }
}

#[test]
fn malformed_offsets_lengths_flags_counts_and_padding_fail_closed() {
    let changes: [fn(&mut QueueItem); 8] = [
        |item| item.callback_discriminator_offset = u32::MAX,
        |item| item.metas_offset += 1,
        |item| item.args_offset -= 1,
        |item| item.args_len = u16::MAX,
        |item| item.metas_len = u16::MAX,
        |item| item.callback_discriminator_len = 9,
        |item| item.used = 2,
        |item| item.identity_mode = 2,
    ];
    for change in changes {
        let mut fixture = Fixture::new();
        let offset = fixture.add(&expected());
        fixture.update_item(offset, change);
        assert_eq!(
            fixture.capture(&expected()),
            Err(CaptureError::InvalidLayout)
        );
    }
    for byte_offset in [18, 20] {
        // header reserved field and header alignment gap
        let mut fixture = Fixture::new();
        fixture.add(&expected());
        fixture.queue_mut()[byte_offset] = 1;
        assert_eq!(
            fixture.capture(&expected()),
            Err(CaptureError::InvalidLayout)
        );
    }
    let mut fixture = Fixture::new();
    fixture.add(&expected());
    QueueAccount::load(fixture.queue_mut())
        .unwrap()
        .header
        .item_count += 1;
    assert_eq!(
        fixture.capture(&expected()),
        Err(CaptureError::InvalidLayout)
    );
}

#[test]
fn malformed_unrelated_record_is_not_ignored_after_a_match() {
    let mut fixture = Fixture::new();
    fixture.add(&expected());
    let other_args = [22; 32];
    let second = fixture.add(&ExpectedRequest {
        args: &other_args,
        ..expected()
    });
    fixture.update_item(second, |item| item.args_offset = u32::MAX);
    assert_eq!(
        fixture.capture(&expected()),
        Err(CaptureError::InvalidLayout)
    );
}

#[test]
fn truncated_oversized_paused_and_unaligned_account_data_are_handled() {
    let mut fixture = Fixture::new();
    fixture.add(&expected());
    let capture = |data| {
        capture_request(
            AccountView {
                key: &fixture.queue_key,
                owner: &solana_vrf_api::ID,
                data,
            },
            AccountView {
                key: &fixture.oracle_key,
                owner: &solana_vrf_api::ID,
                data: fixture.oracle(),
            },
            &fixture.identity,
            &expected(),
        )
    };
    for length in [0, 7, 8, 19, 23, 24, 100] {
        assert_eq!(
            capture(&fixture.queue()[..length]),
            Err(CaptureError::InvalidLayout)
        );
    }
    let mut unaligned = vec![0];
    unaligned.extend_from_slice(fixture.queue());
    assert!(capture(&unaligned[1..]).is_ok());
    let oversized = vec![0; MAX_QUEUE_ACCOUNT_SIZE as usize + 1];
    assert_eq!(capture(&oversized), Err(CaptureError::InvalidLayout));
    QueueAccount::load(fixture.queue_mut())
        .unwrap()
        .header
        .paused = 1;
    assert_eq!(fixture.capture(&expected()), Err(CaptureError::QueuePaused));
}
