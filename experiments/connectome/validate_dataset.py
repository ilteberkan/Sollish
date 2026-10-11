#!/usr/bin/env python3
"""Offline, bounded connectome-export validator. Not a brain model or licence approval.

Only the standard library is used. No downloads, neural-network execution, pickle,
wallets, environment credentials or application integration exist in this tool.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any

MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
MAX_NEURONS = 5_000
MAX_EDGES = 100_000
U64_MAX = (1 << 64) - 1
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
NEUROTRANSMITTERS = {"acetylcholine", "gaba", "glutamate", "dopamine", "serotonin", "octopamine", "unknown"}
CATALOG = {
    "synthetic-fixture": ("LicenseRef-Sollish-Fixture", None, None),
    "flywire-fafb": ("CC-BY-NC-4.0", "https://flywire.ai/guidelines", "https://codex.flywire.ai/api/download?dataset=fafb"),
    "janelia-malecns": ("CC-BY-4.0", "https://male-cns.janelia.org/download/", "https://male-cns.janelia.org/download/"),
}


class ValidationError(Exception):
    """Fixed codes only; raw file contents and OS error details never reach stdout."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ValidationError(code)


def exact(value: Any, fields: set[str], code: str) -> dict:
    require(isinstance(value, dict) and set(value) == fields, code)
    return value


def integer(value: Any, low: int, high: int, code: str) -> int:
    require(type(value) is int and low <= value <= high, code)
    return value


def json_object(pairs: list[tuple[str, Any]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def read_relative(base: Path, relative: str, limit: int) -> bytes:
    """Open beneath the selected manifest directory without following any symlink.

    Descriptor-relative traversal prevents a concurrent directory replacement from
    changing the root of an already-open path. POSIX macOS/Linux only, fail closed.
    """
    require(isinstance(relative, str) and 1 <= len(relative) <= 160 and "\\" not in relative and ":" not in relative, "UNSAFE_PATH")
    parts = relative.split("/")
    require(all(part not in ("", ".", "..") for part in parts), "UNSAFE_PATH")
    nofollow = getattr(os, "O_NOFOLLOW", None)
    require(nofollow is not None and hasattr(os, "O_DIRECTORY"), "UNSUPPORTED_PLATFORM")
    directory = os.open(base, os.O_RDONLY | os.O_DIRECTORY | nofollow)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | nofollow, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(parts[-1], os.O_RDONLY | nofollow | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            require(stat.S_ISREG(info.st_mode), "NOT_REGULAR_FILE")
            require(info.st_size <= limit, "FILE_TOO_LARGE")
            data = handle.read(limit + 1)
            require(len(data) <= limit, "FILE_TOO_LARGE")
            return data
    finally:
        os.close(directory)


def label(value: Any, code: str) -> str:
    require(isinstance(value, str) and 1 <= len(value.encode("utf-8")) <= 160 and all(character.isprintable() for character in value), code)
    return value


def neuron_id(value: str) -> int:
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,19}", value) is not None, "INVALID_NEURON_ID")
    number = int(value)
    require(number <= U64_MAX, "INVALID_NEURON_ID")
    return number


def csv_rows(data: bytes, columns: list[str], maximum: int) -> list[dict[str, str]]:
    try:
        text = data.decode("utf-8", errors="strict")
        require("\x00" not in text, "INVALID_CSV")
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        require(reader.fieldnames == columns, "INVALID_COLUMNS")
        rows = []
        for row in reader:
            require(len(rows) < maximum, "ROW_LIMIT")
            require(set(row) == set(columns) and all(isinstance(value, str) and value != "" for value in row.values()), "INVALID_ROW")
            rows.append(row)
        return rows
    except (UnicodeError, csv.Error) as error:
        raise ValidationError("INVALID_CSV") from error


def validate_manifest(path: Path) -> dict[str, Any]:
    path = Path(path).absolute()
    raw = read_relative(path.parent, path.name, MAX_MANIFEST_BYTES)
    try:
        manifest = json.loads(raw, object_pairs_hook=json_object, parse_constant=lambda _: (_ for _ in ()).throw(ValidationError("INVALID_JSON_NUMBER")))
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValidationError("INVALID_JSON") from error
    exact(manifest, {"schema_version", "dataset", "provenance", "files", "expected", "usage"}, "MANIFEST_SHAPE")
    require(type(manifest["schema_version"]) is int and manifest["schema_version"] == 1, "SCHEMA_VERSION")
    dataset = exact(manifest["dataset"], {"id", "kind", "release", "is_synthetic"}, "DATASET_SHAPE")
    label(dataset["id"], "DATASET_ID")
    require(dataset["kind"] in CATALOG, "DATASET_NOT_REVIEWED")
    label(dataset["release"], "RELEASE_REQUIRED")
    require(type(dataset["is_synthetic"]) is bool and dataset["is_synthetic"] == (dataset["kind"] == "synthetic-fixture"), "FIXTURE_MISLABELLED")
    if dataset["kind"] == "flywire-fafb":
        require(dataset["release"] == "783", "RELEASE_NOT_REVIEWED")
    if dataset["kind"] == "janelia-malecns":
        require(dataset["release"] == "1.0", "RELEASE_NOT_REVIEWED")
    provenance = exact(manifest["provenance"], {"source_url", "license_id", "license_url", "reviewed_at", "attribution", "derivation", "upstream_sha256"}, "PROVENANCE_SHAPE")
    license_id, license_url, source_url = CATALOG[dataset["kind"]]
    require((provenance["license_id"], provenance["license_url"], provenance["source_url"]) == (license_id, license_url, source_url), "SOURCE_LICENSE_MISMATCH")
    require(provenance["reviewed_at"] == "2026-10-02", "REVIEW_NOT_RECORDED")
    label(provenance["attribution"], "ATTRIBUTION_REQUIRED")
    label(provenance["derivation"], "DERIVATION_REQUIRED")
    upstream_hash = provenance["upstream_sha256"]
    if dataset["is_synthetic"]:
        require(upstream_hash is None, "FIXTURE_HAS_FAKE_UPSTREAM")
    else:
        require(isinstance(upstream_hash, str) and HEX64.fullmatch(upstream_hash) is not None and upstream_hash != "0" * 64, "UPSTREAM_HASH_REQUIRED")
    usage = exact(manifest["usage"], {"scope", "commercial_permission", "financial_integration", "consciousness_claim", "biological_fidelity"}, "USAGE_SHAPE")
    require(usage == {"scope": "isolated-research", "commercial_permission": "unresolved", "financial_integration": False, "consciousness_claim": False, "biological_fidelity": "not-validated"}, "PRODUCTION_GATE")
    require(type(usage["financial_integration"]) is bool and type(usage["consciousness_claim"]) is bool, "PRODUCTION_GATE")
    expected = exact(manifest["expected"], {"neurons", "edges"}, "EXPECTED_SHAPE")
    integer(expected["neurons"], 1, MAX_NEURONS, "NEURON_LIMIT")
    integer(expected["edges"], 1, MAX_EDGES, "EDGE_LIMIT")
    files = exact(manifest["files"], {"neurons", "edges"}, "FILES_SHAPE")
    data: dict[str, bytes] = {}
    seen_paths: set[str] = set()
    for key in ("neurons", "edges"):
        item = exact(files[key], {"path", "sha256"}, "FILE_SHAPE")
        require(isinstance(item["path"], str) and item["path"] not in seen_paths, "DUPLICATE_PATH")
        seen_paths.add(item["path"])
        require(isinstance(item["sha256"], str) and HEX64.fullmatch(item["sha256"]) is not None, "INVALID_HASH")
        data[key] = read_relative(path.parent, item["path"], MAX_FILE_BYTES)
        require(hashlib.sha256(data[key]).hexdigest() == item["sha256"], "HASH_MISMATCH")
    neurons = csv_rows(data["neurons"], ["neuron_id", "cell_type", "nt_type"], MAX_NEURONS)
    edges = csv_rows(data["edges"], ["pre_id", "post_id", "synapse_count"], MAX_EDGES)
    require(len(neurons) == expected["neurons"] and len(edges) == expected["edges"], "COUNT_MISMATCH")
    ids: set[int] = set()
    for row in neurons:
        identifier = neuron_id(row["neuron_id"])
        require(identifier not in ids, "DUPLICATE_NEURON")
        ids.add(identifier)
        label(row["cell_type"], "INVALID_CELL_TYPE")
        require(row["nt_type"] in NEUROTRANSMITTERS, "INVALID_NEUROTRANSMITTER")
    pairs: set[tuple[int, int]] = set()
    total_synapses = 0
    for row in edges:
        source, target = neuron_id(row["pre_id"]), neuron_id(row["post_id"])
        require(source in ids and target in ids, "UNKNOWN_ENDPOINT")
        require((source, target) not in pairs, "DUPLICATE_EDGE")
        pairs.add((source, target))
        require(re.fullmatch(r"[1-9][0-9]{0,8}", row["synapse_count"]) is not None, "INVALID_SYNAPSE_COUNT")
        total_synapses += int(row["synapse_count"])
    canonical = {"neurons": sorted(neurons, key=lambda row: int(row["neuron_id"])), "edges": sorted(edges, key=lambda row: (int(row["pre_id"]), int(row["post_id"]))) }
    graph_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return {"validation": "VALID_SYNTHETIC_FIXTURE" if dataset["is_synthetic"] else "VALID_BOUNDED_EXPORT", "dataset_id": dataset["id"], "synthetic": dataset["is_synthetic"], "neurons": len(neurons), "edges": len(edges), "total_synapse_count": total_synapses, "manifest_sha256": hashlib.sha256(raw).hexdigest(), "graph_sha256": graph_hash, "upstream_authenticity": "not-applicable-fixture" if dataset["is_synthetic"] else "declared-not-independently-verified", "commercial_permission": "unresolved", "production_ready": False, "trained_policy_present": False, "consciousness_evidence": False}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args(argv)
    try:
        report = validate_manifest(args.manifest)
    except ValidationError as error:
        print(json.dumps({"validation": "REJECTED", "code": str(error), "production_ready": False}))
        return 1
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        print(json.dumps({"validation": "REJECTED", "code": "UNREADABLE_OR_MALFORMED_INPUT", "production_ready": False}))
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
