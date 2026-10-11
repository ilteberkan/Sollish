#!/usr/bin/env python3
"""CPU-only supervised readout learning on an explicit synthetic decision task.

No self-play/RL claim. Reservoir connectivity comes from actual MaleCNS neurons;
input projection, leaky tanh dynamics and task teacher are engineering assumptions.
Training/validation/test are split by whole generated episodes, never by frames.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import resource
import time

import numpy as np

ACTIONS = ["advance", "circle", "guard", "slip", "jab", "cross", "hook", "kick"]
INPUTS = ["distanceM", "ownStamina", "ownHealth", "opponentWindup", "opponentRecovery", "ownNearRopes", "relativeOpponentLateral", "lastIncomingHigh", "lastIncomingLow", "ticksSinceStrike"]
TRAIN_SEEDS = list(range(1000, 1128))
VALIDATION_SEEDS = list(range(2000, 2032))
TEST_SEEDS = list(range(3000, 3064))
RESERVOIR_SEEDS = [11, 23, 47]
STEPS = 80
LEAK = .35
GAIN = .8


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def teacher(raw, threat_memory):
    """Transparent imitation target; only current/past observable inputs are used."""
    gap, stamina, health, windup, recovery, ropes, lateral, high, low, elapsed = raw
    if stamina < .2:
        return 2
    if gap * 4 > 1.35:
        return 0
    if (windup > .5 or threat_memory > 0) and stamina > .3:
        return 2 if low > .5 else 3
    if (ropes > .65 and gap * 4 < 1.05) or health < .18:
        return 1
    if gap * 4 > 1.15:
        return 7
    if recovery > .5:
        return 5
    if gap * 4 < .8:
        return 6
    if elapsed > .4:
        return 4
    return 1 if abs(lateral) > .5 else 2


def episodes(seeds):
    output = []
    for seed in seeds:
        rng = np.random.default_rng(seed)
        xs, ys = [], []
        memory = 0
        gap = rng.uniform(.55, 1.75)
        stamina, health = rng.uniform(.15, .95), rng.uniform(.15, 1.)
        for tick in range(STEPS):
            if tick % 8 == 0:
                gap = rng.uniform(.55, 1.85)
                stamina, health = rng.uniform(.05, 1.), rng.uniform(.1, 1.)
            gap = float(np.clip(gap + rng.normal(0, .06), .45, 2.2))
            stamina = float(np.clip(stamina + rng.normal(0, .035), 0, 1))
            # Sparse observed windups; their short aftermath is not repeated as an
            # explicit input. Recurrent memory may help imitate defensive timing.
            windup = float(rng.random() < .07)
            memory = 3 if windup else max(0, memory - 1)
            raw = [gap / 4, stamina, health, windup, float(rng.random() < .23), float(rng.random() < .2), float(rng.uniform(-1, 1)), float(rng.random() < .12), float(rng.random() < .12), float(rng.random())]
            x = [value if index == 6 else 2 * value - 1 for index, value in enumerate(raw)]
            xs.append(x)
            ys.append(teacher(raw, memory))
        output.append((np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.int64)))
    return output


def reservoir(graph, seed, variant):
    node_ids = [node["bodyId"] for node in graph["graph"]["nodes"]]
    n = len(node_ids)
    positions = {value: index for index, value in enumerate(node_ids)}
    pre = np.array([positions[a] for a, _, _ in graph["graph"]["edges"]], dtype=np.int64)
    post = np.array([positions[b] for _, b, _ in graph["graph"]["edges"]], dtype=np.int64)
    weights = np.array([weight for _, _, weight in graph["graph"]["edges"]], dtype=np.float64)
    if variant == "scrambled":
        post = np.random.default_rng(seed + 9000).permutation(post)
    totals = np.bincount(post, weights=weights, minlength=n)
    weights = GAIN * weights / np.maximum(totals[post], 1)
    # All recurrent weights are nonnegative: no unverified neurotransmitter sign
    # is inferred. Input projection is fixed random, not a biological receptor map.
    win = np.random.default_rng(seed).uniform(-.65, .65, (n, 11))
    return {"pre": pre, "post": post, "weights": weights, "inputWeights": win, "nodes": n, "variant": variant}


def step(x, state, model):
    drive = model["inputWeights"] @ np.concatenate(([1.], x))
    if model["variant"] == "no-recurrence":
        return np.tanh(drive)
    incoming = np.bincount(model["post"], weights=model["weights"] * state[model["pre"]], minlength=model["nodes"])
    return (1 - LEAK) * state + LEAK * np.tanh(drive + incoming)


def features(data, model):
    rows, targets, episode_ids = [], [], []
    for episode_id, (xs, ys) in enumerate(data):
        state = np.zeros(model["nodes"])
        for x, y in zip(xs, ys, strict=True):
            state = step(x, state, model)
            rows.append(np.concatenate(([1.], x, state)))
            targets.append(y)
            episode_ids.append(episode_id)
    return np.asarray(rows), np.asarray(targets), np.asarray(episode_ids)


def metrics(y, predicted, episode_ids):
    confusion = np.zeros((8, 8), dtype=np.int64)
    np.add.at(confusion, (y, predicted), 1)
    tp = np.diag(confusion)
    recall = tp / np.maximum(confusion.sum(axis=1), 1)
    f1 = 2 * tp / np.maximum(confusion.sum(axis=1) + confusion.sum(axis=0), 1)
    accuracies = np.asarray([np.mean(y[episode_ids == i] == predicted[episode_ids == i]) for i in np.unique(episode_ids)])
    # Deterministic cluster bootstrap resamples whole episodes, not correlated frames.
    rng = np.random.default_rng(7001)
    bootstrap = np.asarray([rng.choice(accuracies, len(accuracies), replace=True).mean() for _ in range(1000)])
    return {"accuracy": float(np.mean(y == predicted)), "macroF1": float(np.mean(f1)), "perActionRecall": recall.tolist(),
            "confusion": confusion.tolist(), "episodeBootstrapAccuracy95": np.quantile(bootstrap, [.025, .975]).tolist(), "frames": len(y), "episodes": len(accuracies)}


def fit(train_x, train_y, validation_x, validation_y):
    counts = np.bincount(train_y, minlength=8)
    if np.any(counts == 0):
        raise ValueError("EMPTY_TRAINING_CLASS")
    sample_weights = len(train_y) / (8 * counts[train_y])
    targets = np.eye(8)[train_y]
    covariance = train_x.T @ (sample_weights[:, None] * train_x)
    product = train_x.T @ (sample_weights[:, None] * targets)
    best = None
    for regularization in [.1, 1., 10.]:
        readout = np.linalg.solve(covariance + regularization * np.eye(train_x.shape[1]), product)
        prediction = np.argmax(validation_x @ readout, axis=1)
        score = metrics(validation_y, prediction, np.arange(len(validation_y)) // STEPS)["macroF1"]
        if best is None or score > best[0]:
            best = (score, regularization, readout)
    return best[1], best[2]


def run(graph_path: Path, output: Path):
    start = time.monotonic()
    graph = json.loads(graph_path.read_text())
    if sha(graph["graph"]) != graph["graphSha256"] or graph["nodeCount"] != 128:
        raise ValueError("GRAPH_HASH_OR_SHAPE")
    train, validation, test = episodes(TRAIN_SEEDS), episodes(VALIDATION_SEEDS), episodes(TEST_SEEDS)
    dataset_hash = sha({"train": [[x.tolist(), y.tolist()] for x, y in train], "validation": [[x.tolist(), y.tolist()] for x, y in validation], "test": [[x.tolist(), y.tolist()] for x, y in test]})
    results = []
    chosen = None
    parity = None
    for seed in RESERVOIR_SEEDS:
        for variant in ["connectome", "scrambled", "no-recurrence"]:
            model = reservoir(graph, seed, variant)
            tx, ty, _ = features(train, model)
            vx, vy, _ = features(validation, model)
            ex, ey, ei = features(test, model)
            regularization, readout = fit(tx, ty, vx, vy)
            test_metrics = metrics(ey, np.argmax(ex @ readout, axis=1), ei)
            result = {"seed": seed, "variant": variant, "regularizationSelectedOnValidation": regularization, "readoutParameters": readout.size,
                      "zeroReadoutAccuracy": float(np.mean(ey == 0)), "test": test_metrics}
            results.append(result)
            print(json.dumps({"seed": seed, "variant": variant, "accuracy": test_metrics["accuracy"], "macroF1": test_metrics["macroF1"]}), flush=True)
            if seed == 11 and variant == "connectome":
                chosen = {"schemaVersion": 1, "version": "malecns-descending128-imitation-v1", "trainingSeed": seed, "nodeIds": [row["bodyId"] for row in graph["graph"]["nodes"]],
                          "graphSha256": graph["graphSha256"], "sourceHashes": graph["sourceHashes"], "datasetSha256": dataset_hash,
                          "inputNames": INPUTS, "actions": ACTIONS, "leak": LEAK,
                          "pre": model["pre"].tolist(), "post": model["post"].tolist(), "weights": model["weights"].tolist(),
                          "inputWeights": model["inputWeights"].tolist(), "readout": readout.T.tolist(),
                          "learning": "class-balanced ridge regression of 8-action readout; fixed sparse recurrent graph and random input projection",
                          "biologicalDynamics": "assumed leaky tanh; nonnegative row-normalized recurrence; not calibrated neurons", "wholeBrain": False, "consciousnessClaim": False, "financialIntegration": False}
                state = np.zeros(128)
                parity = []
                for x in test[0][0][:20]:
                    state = step(x, state, model)
                    scores = np.concatenate(([1.], x, state)) @ readout
                    parity.append({"inputs": x.tolist(), "scores": scores.tolist(), "state": state.tolist(), "action": ACTIONS[int(np.argmax(scores))]})
    # Input-only linear classifier, fitted on the identical labelled episodes.
    tx = np.asarray([np.concatenate(([1.], x)) for xs, _ in train for x in xs]); ty = np.concatenate([y for _, y in train])
    vx = np.asarray([np.concatenate(([1.], x)) for xs, _ in validation for x in xs]); vy = np.concatenate([y for _, y in validation])
    ex = np.asarray([np.concatenate(([1.], x)) for xs, _ in test for x in xs]); ey = np.concatenate([y for _, y in test])
    reg, readout = fit(tx, ty, vx, vy)
    linear = metrics(ey, np.argmax(ex @ readout, axis=1), np.arange(len(ey)) // STEPS)
    assert chosen is not None and parity is not None
    chosen_hash = sha(chosen)
    chosen_metrics = results[0]["test"]
    valid_candidate = chosen_metrics["accuracy"] >= .75 and chosen_metrics["macroF1"] >= .65 and min(chosen_metrics["perActionRecall"]) >= .35
    report = {"schemaVersion": 1, "observedAt": datetime.now(timezone.utc).isoformat(), "task": "synthetic partially-observed tactical teacher imitation, not engine wins/RL",
              "sourceGraphSha256": graph["graphSha256"], "datasetSha256": dataset_hash, "modelSha256": chosen_hash,
              "split": {"trainEpisodeSeeds": TRAIN_SEEDS, "validationEpisodeSeeds": VALIDATION_SEEDS, "testEpisodeSeeds": TEST_SEEDS, "stepsPerEpisode": STEPS, "episodesDisjoint": True, "unseenOpponentPhysicsTested": False},
              "selection": "export seed11/connectome predeclared, NOT best test seed; ridge alpha selected using validation only",
              "comparators": results, "linearInputOnly": {"regularization": reg, "test": linear},
              "acceptance": {"criterion": "chosen test accuracy>=.75; macroF1>=.65; every action recall>=.35", "passed": valid_candidate, "closedLoopCombatValidated": False, "runtimeParityValidated": False},
              "runtime": {"python": platform.python_version(), "numpy": np.__version__, "machine": platform.machine(), "seconds": round(time.monotonic()-start, 3), "maxRssBytesDarwin": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss},
              "limitations": ["128 selected descending neurons, not all neurons", "fixed assumed reservoir dynamics; only readout learned", "synthetic teacher-labelled data, not biological recordings", "no self-play or fighting improvement evidence", "shared task generator across train/test; no independent external task", "no biological-fidelity or consciousness evidence", "product licensing and financial gates remain separate"], "productionReady": False}
    output.mkdir(parents=True, exist_ok=True)
    (output / "policy-model.json").write_text(json.dumps(chosen, separators=(",", ":"), allow_nan=False) + "\n")
    (output / "policy-evaluation.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    (output / "policy-parity.json").write_text(json.dumps({"modelSha256": chosen_hash, "steps": parity}, separators=(",", ":"), allow_nan=False) + "\n")
    print(json.dumps({"modelSha256": chosen_hash, "candidatePassed": valid_candidate, "linear": linear["accuracy"], "seconds": report["runtime"]["seconds"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("graph", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    run(args.graph, args.output)
