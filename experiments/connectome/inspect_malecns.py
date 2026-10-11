#!/usr/bin/env python3
"""Offline, hash-pinned MaleCNS v1.0 Arrow batch import; no neural simulation.

The original sparse edge table is retained losslessly. It is NOT converted to a
dense adjacency matrix. The status==Traced view is descriptive, not a claim to
reproduce Codex's curated neuron set. This module does not download anything.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import resource
import sys
import time

import pyarrow as pa
import pyarrow.compute as pc

FILES = {
    "annotations": ("body-annotations-male-cns-v1.0-minconf-0.5.feather", "2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2"),
    "neurotransmitters": ("body-neurotransmitters-male-cns-v1.0.feather", "95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621"),
    "weights": ("connectome-weights-male-cns-v1.0-minconf-0.5.feather", "e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1"),
}
MAX_FILE_BYTES = 1_200_000_000
MAX_ROWS = 200_000_000
MAX_BATCH_ROWS = 65_536
MAX_BATCHES = 4_096


class InspectionError(Exception):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise InspectionError(code)


def fingerprint(path: Path, expected: str) -> dict:
    require(path.is_file() and not path.is_symlink(), "NOT_REGULAR_FILE")
    size = path.stat().st_size
    require(0 < size <= MAX_FILE_BYTES, "SOURCE_SIZE")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    require(digest.hexdigest() == expected, "SOURCE_HASH_MISMATCH")
    return {"file": path.name, "bytes": size, "sha256": digest.hexdigest()}


def inspect_table(path: Path, expected: str, id_column: str) -> tuple[dict, pa.Table | None]:
    result = fingerprint(path, expected)
    rows = uncompressed = 0
    kept = []
    with pa.memory_map(str(path), "r") as source:
        reader = pa.ipc.open_file(source)
        require(reader.num_record_batches <= MAX_BATCHES, "BATCH_LIMIT")
        require(reader.schema.field(id_column).type == pa.int64(), "ID_SCHEMA")
        for number in range(reader.num_record_batches):
            batch = reader.get_batch(number)
            require(0 < batch.num_rows <= MAX_BATCH_ROWS, "BATCH_ROW_LIMIT")
            rows += batch.num_rows
            uncompressed += batch.nbytes
            require(rows <= 2_000_000, "METADATA_ROW_LIMIT")
            ids = batch.column(id_column)
            require(ids.null_count == 0 and pc.min(ids).as_py() > 0, "INVALID_ID")
            if id_column == "bodyId":
                require(batch.schema.field("status").type == pa.string(), "STATUS_SCHEMA")
                kept.append(batch.select(["bodyId", "status"]))
        result.update(rows=rows, batches=reader.num_record_batches, uncompressed_bytes=uncompressed,
                      schema=[{"name": field.name, "type": str(field.type)} for field in reader.schema])
    return result, pa.Table.from_batches(kept) if kept else None


def scan_weights(path: Path, expected: str, traced_ids: pa.Array) -> dict:
    result = fingerprint(path, expected)
    require(traced_ids.type == pa.int64() and traced_ids.null_count == 0, "TRACED_IDS")
    lookup = pc.SetLookupOptions(value_set=traced_ids)
    rows = total_weight = traced_rows = traced_weight = self_loops = maximum_weight = maximum_id = 0
    minimum_weight = None
    with pa.memory_map(str(path), "r") as source:
        reader = pa.ipc.open_file(source)
        require(reader.schema.remove_metadata() == pa.schema([(key, pa.int64()) for key in ("body_pre", "body_post", "weight")]), "WEIGHTS_SCHEMA")
        require(0 < reader.num_record_batches <= MAX_BATCHES, "BATCH_LIMIT")
        for number in range(reader.num_record_batches):
            batch = reader.get_batch(number)
            require(0 < batch.num_rows <= MAX_BATCH_ROWS, "BATCH_ROW_LIMIT")
            rows += batch.num_rows
            require(rows <= MAX_ROWS, "WEIGHTS_ROW_LIMIT")
            pre, post, weight = batch.columns
            require(all(column.null_count == 0 for column in batch.columns), "NULL_WEIGHT_OR_ENDPOINT")
            require(pc.min(pre).as_py() > 0 and pc.min(post).as_py() > 0, "INVALID_ID")
            low, high = pc.min(weight).as_py(), pc.max(weight).as_py()
            require(1 <= low <= high <= 1_000_000_000, "INVALID_WEIGHT")
            # Per-batch int64 sum cannot overflow with the above size/value caps.
            total_weight += pc.sum(weight).as_py()
            maximum_weight = max(maximum_weight, high)
            minimum_weight = low if minimum_weight is None else min(minimum_weight, low)
            maximum_id = max(maximum_id, pc.max(pre).as_py(), pc.max(post).as_py())
            self_loops += pc.sum(pc.cast(pc.equal(pre, post), pa.int64())).as_py()
            mask = pc.and_(pc.is_in(pre, options=lookup), pc.is_in(post, options=lookup))
            selected = pc.filter(weight, mask)
            traced_rows += len(selected)
            traced_weight += pc.sum(selected).as_py() or 0
        result.update(rows=rows, batches=reader.num_record_batches, schema=[{"name": field.name, "type": str(field.type)} for field in reader.schema],
                      summed_integer_weights=total_weight, weight_min=minimum_weight, weight_max=maximum_weight,
                      max_segment_id=maximum_id, self_loop_rows=self_loops, uncompressed_bytes=rows * 24,
                      traced_endpoint_view={"filter": "annotations.status == 'Traced' for BOTH endpoints; no weight threshold", "nodes_in_annotation_filter": len(traced_ids), "edge_rows": traced_rows, "summed_integer_weights": traced_weight, "matches_codex_neuron_set": "not-established"},
                      import_format="lossless original int64 sparse edge table, consumed record-batch by record-batch",
                      duplicate_pairs="not-tested; source rows retained, no aggregation or deduplication",
                      dense_matrix_created=False, csr_created=False)
    return result


def inspect(cache: Path) -> dict:
    started = time.monotonic()
    annotation, table = inspect_table(cache / FILES["annotations"][0], FILES["annotations"][1], "bodyId")
    assert table is not None
    ids = table["bodyId"].combine_chunks()
    require(len(pc.unique(ids)) == len(ids), "DUPLICATE_ANNOTATION_ID")
    status = table["status"].combine_chunks()
    counts = Counter(status.to_pylist())
    annotation["status_counts"] = {key if key is not None else "<null>": value for key, value in counts.items()}
    annotation["unique_body_ids"] = len(ids)
    traced_ids = pc.filter(ids, pc.equal(status, "Traced"))
    nt, _ = inspect_table(cache / FILES["neurotransmitters"][0], FILES["neurotransmitters"][1], "body")
    weights = scan_weights(cache / FILES["weights"][0], FILES["weights"][1], traced_ids)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {"schema_version": 1, "status": "COMPLETE_OFFLINE_BATCH_IMPORT", "observed_at": datetime.now(timezone.utc).isoformat(),
            "dataset": "male-cns:v1.0", "source_url": "https://male-cns.janelia.org/download/", "source_license": "CC-BY-4.0",
            "files": {"annotations": annotation, "neurotransmitters": nt, "weights": weights},
            "runtime": {"python": platform.python_version(), "pyarrow": pa.__version__, "system": platform.system(), "machine": platform.machine(), "seconds": round(time.monotonic() - started, 3), "process_peak_rss_bytes": rss if sys.platform == "darwin" else rss * 1024},
            "source_integrity": "SHA256 pinned from official HTTPS downloads; not a signed upstream checksum",
            "commercial_permission": "unresolved-product-review; data-license-allows-commercial-with-attribution", "financial_integration": False,
            "trained_policy_present": False, "biological_fidelity": "not-validated", "consciousness_evidence": False, "production_ready": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    args = parser.parse_args()
    try:
        report = inspect(args.cache)
    except InspectionError as error:
        print(json.dumps({"status": "REJECTED", "code": str(error), "production_ready": False}))
        return 1
    except (OSError, ValueError, KeyError, pa.ArrowException):
        print(json.dumps({"status": "REJECTED", "code": "SOURCE_UNREADABLE_OR_MALFORMED", "production_ready": False}))
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
