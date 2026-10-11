#!/usr/bin/env python3
"""Extract a deterministic, bounded real MaleCNS descending-neuron subgraph.

This is a scientific selection rule, not the whole brain. Source weights remain
positive integer synapse counts. Repeated directed pairs are explicitly summed.
"""
from collections import Counter
import argparse
import hashlib
import json
from pathlib import Path
import time

import pyarrow as pa
import pyarrow.compute as pc

from inspect_malecns import FILES, fingerprint, require

NODES = 128


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def extract(cache: Path):
    start = time.monotonic()
    annotation_path = cache / FILES["annotations"][0]
    weights_path = cache / FILES["weights"][0]
    fingerprint(annotation_path, FILES["annotations"][1])
    fingerprint(weights_path, FILES["weights"][1])
    with pa.memory_map(str(annotation_path), "r") as source:
        table = pa.ipc.open_file(source).read_all()
    mask = pc.and_(pc.equal(table["status"], "Traced"), pc.equal(table["superclass"], "descending_neuron"))
    selected = table.filter(mask).select(["bodyId", "type", "superclass", "status"])
    ids = selected["bodyId"].combine_chunks()
    require(NODES <= len(ids) <= 2_000 and len(pc.unique(ids)) == len(ids), "CANDIDATE_SET")
    lookup = pc.SetLookupOptions(value_set=ids)
    edges = Counter()
    rows = matched = 0
    with pa.memory_map(str(weights_path), "r") as source:
        reader = pa.ipc.open_file(source)
        require(reader.schema.remove_metadata() == pa.schema([(key, pa.int64()) for key in ("body_pre", "body_post", "weight")]), "WEIGHT_SCHEMA")
        for number in range(reader.num_record_batches):
            batch = reader.get_batch(number)
            rows += batch.num_rows
            require(batch.num_rows <= 65_536 and rows <= 200_000_000, "ROW_LIMIT")
            pre, post, weight = batch.columns
            mask = pc.and_(pc.is_in(pre, options=lookup), pc.is_in(post, options=lookup))
            kept = batch.filter(mask).to_pydict()
            matched += len(kept["weight"])
            require(matched <= 1_000_000, "CANDIDATE_EDGE_LIMIT")
            for a, b, count in zip(kept["body_pre"], kept["body_post"], kept["weight"], strict=True):
                require(type(count) is int and 0 < count <= 1_000_000_000, "INVALID_WEIGHT")
                edges[(a, b)] += count
    strength = Counter()
    for (a, b), weight in edges.items():
        strength[a] += weight
        strength[b] += weight
    node_ids = sorted(sorted(ids.to_pylist(), key=lambda identifier: (-strength[identifier], identifier))[:NODES])
    included = set(node_ids)
    nodes = [row for row in selected.to_pylist() if row["bodyId"] in included]
    nodes.sort(key=lambda row: row["bodyId"])
    induced = [[a, b, weight] for (a, b), weight in sorted(edges.items()) if a in included and b in included]
    require(len(induced) <= 16_384 and all(weight < 2**53 for _, _, weight in induced), "INDUCED_BOUND")
    payload = {"nodes": nodes, "edges": induced}
    return {"schemaVersion": 1, "dataset": "male-cns:v1.0", "license": "CC-BY-4.0", "sourceUrl": "https://male-cns.janelia.org/download/",
            "sourceHashes": {key: value[1] for key, value in FILES.items() if key in ("annotations", "weights")},
            "selection": "status == Traced AND superclass == descending_neuron; select 128 largest summed incoming+outgoing integer weights within that candidate set; ties ascending bodyId; retain every induced directed edge, including self-loops",
            "candidateNodes": len(ids), "candidateEdgeRows": matched, "candidateUniqueEdges": len(edges),
            "rawRowsScanned": rows, "duplicateAggregation": "sum positive integer weights by directed bodyId pair before degree ranking",
            "graphSha256": canonical_sha(payload), "nodeCount": len(nodes), "edgeCount": len(induced), "summedWeights": sum(row[2] for row in induced),
            "graph": payload, "seconds": round(time.monotonic()-start, 3), "wholeBrain": False,
            "biologicalDynamicsValidated": False, "consciousnessClaim": False, "financialIntegration": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = extract(args.cache)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "graph"}, indent=2))
