//! Read-only capture adapter for the pinned MagicBlock queue ABI.
//! NON-PRODUCTION: this does not authenticate caller-supplied Clock/SlotHashes.
//! The admission instruction must obtain those from the genuine sysvars, pin the
//! configured queue, and call this immediately after its own successful VRF CPI.

use core::mem::{align_of, size_of};
use solana_curve25519::ristretto::validate_ristretto;
use solana_program::{hash::hashv, pubkey::Pubkey};
use solana_vrf_api::{
    consts::MAX_QUEUE_ACCOUNT_SIZE,
    state::{
        oracle_data_pda, oracle_queue_pda, scoped_identity_pda, AccountDiscriminator,
        CompactAccountMeta, Oracle, Queue, QueueItem,
    },
};

const DISCRIMINATOR_LEN: usize = 8;
const MAX_METAS: usize = 25;
const MAX_ARGS: usize = 512;

#[derive(Clone, Copy)]
pub struct AccountView<'a> {
    pub key: &'a Pubkey,
    pub owner: &'a Pubkey,
    pub data: &'a [u8],
}

pub struct ExpectedRequest<'a> {
    pub callback_program: &'a Pubkey,
    pub caller_seed: &'a [u8; 32],
    pub discriminator: &'a [u8],
    pub metas: &'a [CompactAccountMeta],
    pub args: &'a [u8],
    pub slot: u64,
    pub unix_timestamp: i64,
    pub slot_hash: &'a [u8; 32],
    pub high_priority: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapturedRequest {
    pub input: [u8; 32],
    pub oracle_vrf_key: [u8; 32],
    pub request_slot: u64,
    pub created_at: i64,
    /// Byte offset relative to the queue body AFTER its 8-byte discriminator.
    pub item_offset: u32,
    pub queue_index: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureError {
    WrongOwner,
    WrongQueueAddress,
    WrongOracleAddress,
    InvalidLayout,
    InvalidOracleKey,
    InvalidExpectedRequest,
    QueuePaused,
    RequestNotFound,
    AmbiguousRequest,
    RequestMismatch,
    InputMismatch,
}

fn aligned(value: usize) -> Result<usize, CaptureError> {
    let alignment = align_of::<QueueItem>();
    value
        .checked_add(alignment - 1)
        .map(|sum| sum & !(alignment - 1))
        .ok_or(CaptureError::InvalidLayout)
}

fn checked_end(start: usize, length: usize) -> Result<usize, CaptureError> {
    start.checked_add(length).ok_or(CaptureError::InvalidLayout)
}

fn bytes(data: &[u8], start: usize, length: usize) -> Result<&[u8], CaptureError> {
    data.get(start..checked_end(start, length)?)
        .ok_or(CaptureError::InvalidLayout)
}

/// One bounded O(n) scan, no queue-sized allocations and no account mutations.
/// All queue records are checked, including holes; a malformed unrelated record
/// causes admission rollback rather than allowing a partial scan to look valid.
pub fn capture_request(
    queue: AccountView<'_>,
    oracle_data: AccountView<'_>,
    oracle_identity: &Pubkey,
    expected: &ExpectedRequest<'_>,
) -> Result<CapturedRequest, CaptureError> {
    if queue.owner != &solana_vrf_api::ID || oracle_data.owner != &solana_vrf_api::ID {
        return Err(CaptureError::WrongOwner);
    }
    if expected.discriminator.len() > 8
        || expected.metas.len() > MAX_METAS
        || expected.args.len() > MAX_ARGS
        || expected.metas.iter().any(|meta| meta.is_writable > 1)
    {
        return Err(CaptureError::InvalidExpectedRequest);
    }
    if queue.data.len() > MAX_QUEUE_ACCOUNT_SIZE as usize
        || bytes(queue.data, 0, DISCRIMINATOR_LEN)? != AccountDiscriminator::Queue.to_bytes()
    {
        return Err(CaptureError::InvalidLayout);
    }
    let body = &queue.data[DISCRIMINATOR_LEN..];
    let header: Queue = bytemuck::pod_read_unaligned(bytes(body, 0, size_of::<Queue>())?);
    if header._padding != [0; 2] || header.paused > 1 {
        return Err(CaptureError::InvalidLayout);
    }
    if queue.key != &oracle_queue_pda(oracle_identity, header.index).0 {
        return Err(CaptureError::WrongQueueAddress);
    }
    if oracle_data.key != &oracle_data_pda(oracle_identity).0 {
        return Err(CaptureError::WrongOracleAddress);
    }
    if oracle_data.data.len() != DISCRIMINATOR_LEN + size_of::<Oracle>()
        || bytes(oracle_data.data, 0, DISCRIMINATOR_LEN)? != AccountDiscriminator::Oracle.to_bytes()
    {
        return Err(CaptureError::InvalidLayout);
    }
    let oracle: Oracle = bytemuck::pod_read_unaligned(&oracle_data.data[DISCRIMINATOR_LEN..]);
    if oracle.vrf_pubkey.0 == [0; 32] || !validate_ristretto(&oracle.vrf_pubkey) {
        return Err(CaptureError::InvalidOracleKey);
    }
    if header.paused != 0 {
        return Err(CaptureError::QueuePaused);
    }

    let start = aligned(size_of::<Queue>())?;
    if bytes(body, size_of::<Queue>(), start - size_of::<Queue>())?
        .iter()
        .any(|byte| *byte != 0)
    {
        return Err(CaptureError::InvalidLayout);
    }
    let end = header.cursor as usize;
    if end < start || end > body.len() {
        return Err(CaptureError::InvalidLayout);
    }
    let expected_bump = scoped_identity_pda(expected.callback_program).1;
    let mut position = start;
    let mut used_count = 0_u32;
    let mut found: Option<(QueueItem, u32)> = None;
    while position < end {
        let item_end = checked_end(position, size_of::<QueueItem>())?;
        if item_end > end {
            return Err(CaptureError::InvalidLayout);
        }
        let item: QueueItem =
            bytemuck::pod_read_unaligned(bytes(body, position, size_of::<QueueItem>())?);
        if item.used > 1
            || item.priority_request > 1
            || item.identity_mode > 1
            || item.callback_discriminator_len > 8
            || item.metas_len as usize > MAX_METAS
            || item.args_len as usize > MAX_ARGS
        {
            return Err(CaptureError::InvalidLayout);
        }
        let disc_end = checked_end(item_end, item.callback_discriminator_len as usize)?;
        let metas_len = (item.metas_len as usize)
            .checked_mul(size_of::<CompactAccountMeta>())
            .ok_or(CaptureError::InvalidLayout)?;
        let metas_end = checked_end(disc_end, metas_len)?;
        let args_end = checked_end(metas_end, item.args_len as usize)?;
        if item.callback_discriminator_offset as usize != item_end
            || item.metas_offset as usize != disc_end
            || item.args_offset as usize != metas_end
            || args_end > end
        {
            return Err(CaptureError::InvalidLayout);
        }
        let next = aligned(args_end)?;
        // Upstream cursor is either the unaligned end of its final insertion,
        // or an aligned end after trimming/reusing holes. Both are valid.
        if next > end && args_end != end {
            return Err(CaptureError::InvalidLayout);
        }
        let actual_metas = bytes(body, disc_end, metas_len)?;
        for encoded in actual_metas.chunks_exact(size_of::<CompactAccountMeta>()) {
            let meta: CompactAccountMeta = bytemuck::pod_read_unaligned(encoded);
            if meta.is_writable > 1 {
                return Err(CaptureError::InvalidLayout);
            }
        }
        if item.used == 1 {
            used_count = used_count
                .checked_add(1)
                .ok_or(CaptureError::InvalidLayout)?;
            if item.callback_program_id == expected.callback_program.to_bytes()
                && bytes(body, item_end, item.callback_discriminator_len as usize)?
                    == expected.discriminator
                && actual_metas == bytemuck::cast_slice(expected.metas)
                && bytes(body, metas_end, item.args_len as usize)? == expected.args
            {
                if found.is_some() {
                    return Err(CaptureError::AmbiguousRequest);
                }
                found = Some((
                    item,
                    u32::try_from(position).map_err(|_| CaptureError::InvalidLayout)?,
                ));
            }
        }
        position = next;
    }
    if used_count != header.item_count {
        return Err(CaptureError::InvalidLayout);
    }
    let (item, item_offset) = found.ok_or(CaptureError::RequestNotFound)?;
    if item.slot != expected.slot
        || item.created_at != QueueItem::created_at_from(expected.unix_timestamp)
        || item.priority_request != u8::from(expected.high_priority)
        || item.identity_mode != 1
        || item.identity_bump != expected_bump
    {
        return Err(CaptureError::RequestMismatch);
    }
    let input = hashv(&[
        expected.caller_seed,
        &expected.slot.to_le_bytes(),
        expected.slot_hash,
        expected.discriminator,
        expected.callback_program.as_ref(),
        &expected.unix_timestamp.to_le_bytes(),
        &item_offset.to_le_bytes(),
    ])
    .to_bytes();
    if item.id != input {
        return Err(CaptureError::InputMismatch);
    }
    Ok(CapturedRequest {
        input,
        oracle_vrf_key: oracle.vrf_pubkey.0,
        request_slot: item.slot,
        created_at: expected.unix_timestamp,
        item_offset,
        queue_index: header.index,
    })
}

#[cfg(test)]
mod tests;
