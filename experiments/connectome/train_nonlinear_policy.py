#!/usr/bin/env python3
"""Second, predeclared experiment: supervised nonlinear readout, fresh test seeds.

The failed ridge run is retained. Only the two-layer readout is optimized (Adam);
the measured anatomical graph and assumed reservoir dynamics stay frozen.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import resource
import time

import numpy as np
from train_policy import ACTIONS, INPUTS, TRAIN_SEEDS, VALIDATION_SEEDS, RESERVOIR_SEEDS, STEPS, LEAK, episodes, features, metrics, reservoir, sha, step

FINAL_TEST_SEEDS = list(range(4000, 4064))
HIDDEN = 32
EPOCHS = 80


def scores(x, head):
    z = (x - head["mean"]) / head["scale"]
    return np.maximum(z @ head["w1"] + head["b1"], 0) @ head["w2"] + head["b2"]


def fit_head(tx, ty, vx, vy, seed):
    rng = np.random.default_rng(seed + 20200)
    mean, scale = tx.mean(0), np.maximum(tx.std(0), .1)
    x = (tx-mean)/scale
    # The constant feature is redundant with learned biases, retained for ABI parity.
    p = [rng.normal(0, .08, (tx.shape[1], HIDDEN)), np.zeros(HIDDEN), rng.normal(0, .08, (HIDDEN, 8)), np.zeros(8)]
    m, v = [np.zeros_like(a) for a in p], [np.zeros_like(a) for a in p]
    counts = np.bincount(ty, minlength=8)
    if np.any(counts == 0):
        raise ValueError("EMPTY_TRAINING_CLASS")
    weights = len(ty)/(8*counts[ty])
    best_score, best, best_epoch, iteration = -1, None, 0, 0
    history = []
    for epoch in range(1, EPOCHS+1):
        order = rng.permutation(len(ty))
        for start in range(0, len(ty), 256):
            idx = order[start:start+256]
            bx, by = x[idx], ty[idx]
            w1, b1, w2, b2 = p
            pre = bx @ w1 + b1
            hidden = np.maximum(pre, 0)
            logits = hidden @ w2 + b2
            exp = np.exp(logits - logits.max(axis=1, keepdims=True))
            delta = exp/exp.sum(axis=1, keepdims=True)
            delta[np.arange(len(by)), by] -= 1
            delta *= weights[idx, None] / len(by)
            back = (delta @ w2.T) * (pre > 0)
            gradients = [bx.T @ back + 1e-4*w1, back.sum(0), hidden.T @ delta + 1e-4*w2, delta.sum(0)]
            iteration += 1
            for index, gradient in enumerate(gradients):
                m[index] = .9*m[index]+.1*gradient
                v[index] = .999*v[index]+.001*gradient**2
                p[index] -= .002*(m[index]/(1-.9**iteration))/(np.sqrt(v[index]/(1-.999**iteration))+1e-8)
        if epoch % 5 == 0:
            head = {"mean": mean, "scale": scale, "w1": p[0], "b1": p[1], "w2": p[2], "b2": p[3]}
            prediction = np.argmax(scores(vx, head), axis=1)
            confusion = np.zeros((8, 8), dtype=np.int64)
            np.add.at(confusion, (vy, prediction), 1)
            f1 = float(np.mean(2*np.diag(confusion)/np.maximum(confusion.sum(0)+confusion.sum(1), 1)))
            history.append({"epoch": epoch, "validationMacroF1": f1})
            if f1 > best_score:
                best_score, best_epoch = f1, epoch
                best = {key: value.copy() for key, value in head.items()}
    return best, best_epoch, history


def run(graph_path, output):
    start = time.monotonic()
    graph = json.loads(graph_path.read_text())
    if sha(graph["graph"]) != graph["graphSha256"] or graph["nodeCount"] != 128:
        raise ValueError("GRAPH_HASH_OR_SHAPE")
    train, validation, test = episodes(TRAIN_SEEDS), episodes(VALIDATION_SEEDS), episodes(FINAL_TEST_SEEDS)
    data_hash = sha({"train": [[x.tolist(), y.tolist()] for x,y in train], "validation": [[x.tolist(),y.tolist()] for x,y in validation], "test": [[x.tolist(),y.tolist()] for x,y in test]})
    results, chosen, parity = [], None, None
    for seed in RESERVOIR_SEEDS:
        for variant in ["connectome", "scrambled", "no-recurrence"]:
            model = reservoir(graph, seed, variant)
            tx,ty,_ = features(train,model); vx,vy,_ = features(validation,model); ex,ey,ei = features(test,model)
            head, epoch, history = fit_head(tx,ty,vx,vy,seed)
            measured = metrics(ey,np.argmax(scores(ex,head),axis=1),ei)
            results.append({"seed":seed,"variant":variant,"selectedEpoch":epoch,"validationHistory":history,"readoutParameters":int(sum(head[key].size for key in ("w1","b1","w2","b2"))),"test":measured})
            print(json.dumps({"seed":seed,"variant":variant,"accuracy":measured["accuracy"],"macroF1":measured["macroF1"]}),flush=True)
            if seed == 11 and variant == "connectome":
                chosen = {"schemaVersion":2,"version":"malecns-descending128-imitation-mlp-v2","trainingSeed":seed,"nodeIds":[node["bodyId"] for node in graph["graph"]["nodes"]],
                          "graphSha256":graph["graphSha256"],"sourceHashes":graph["sourceHashes"],"datasetSha256":data_hash,"inputNames":INPUTS,"actions":ACTIONS,"leak":LEAK,
                          "pre":model["pre"].tolist(),"post":model["post"].tolist(),"weights":model["weights"].tolist(),"inputWeights":model["inputWeights"].tolist(),
                          "head":{key:value.tolist() for key,value in head.items()},"learning":"supervised 139->32 ReLU->8 readout; class-balanced Adam; fixed sparse graph and input projection",
                          "biologicalDynamics":"assumed leaky tanh; nonnegative row-normalized recurrence; not calibrated neurons","wholeBrain":False,"consciousnessClaim":False,"financialIntegration":False}
                state=np.zeros(128); parity=[]
                for x in test[0][0][:20]:
                    state=step(x,state,model); score=scores(np.concatenate(([1.],x,state)),head)
                    parity.append({"inputs":x.tolist(),"scores":score.tolist(),"state":state.tolist(),"action":ACTIONS[int(np.argmax(score))]})
    # Independent simple MLP on current observations: no recurrent state.
    tx=np.asarray([x for xs,_ in train for x in xs]);ty=np.concatenate([y for _,y in train])
    vx=np.asarray([x for xs,_ in validation for x in xs]);vy=np.concatenate([y for _,y in validation])
    ex=np.asarray([x for xs,_ in test for x in xs]);ey=np.concatenate([y for _,y in test])
    head,epoch,_=fit_head(tx,ty,vx,vy,11)
    baseline=metrics(ey,np.argmax(scores(ex,head),axis=1),np.arange(len(ey))//STEPS)
    model_hash=sha(chosen)
    selected=results[0]["test"]
    report={"schemaVersion":2,"observedAt":datetime.now(timezone.utc).isoformat(),"method":"nonlinear supervised readout; fixed anatomical reservoir",
            "task":"synthetic partially-observed tactical teacher imitation, not combat wins, self-play or RL","sourceGraphSha256":graph["graphSha256"],"datasetSha256":data_hash,"modelSha256":model_hash,
            "previousExperiment":"policy-evaluation.json retains failed ridge result; test seeds3000..3063 are not reused here",
            "split":{"trainEpisodeSeeds":TRAIN_SEEDS,"validationEpisodeSeeds":VALIDATION_SEEDS,"testEpisodeSeeds":FINAL_TEST_SEEDS,"stepsPerEpisode":STEPS,"episodesDisjoint":True,"unseenOpponentPhysicsTested":False},
            "selection":"seed11/connectome predeclared; epoch selected only by validation macroF1; final seeds4000..4063 evaluated after training",
            "comparators":results,"inputOnlyMLP":{"hidden":HIDDEN,"parameters":616,"selectedEpoch":epoch,"test":baseline},
            "acceptance":{"criterion":"selected accuracy>=.75; macroF1>=.65; every action recall>=.35","passed":selected["accuracy"]>=.75 and selected["macroF1"]>=.65 and min(selected["perActionRecall"])>=.35,"runtimeParityValidated":False,"closedLoopCombatValidated":False},
            "runtime":{"python":platform.python_version(),"numpy":np.__version__,"machine":platform.machine(),"seconds":round(time.monotonic()-start,3),"maxRssBytesDarwin":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss},
            "topologySuperiorityClaim":False,"biologicalFidelityValidated":False,"consciousnessEvidence":False,"productionReady":False}
    output.mkdir(parents=True,exist_ok=True)
    (output/"policy-mlp-model.json").write_text(json.dumps(chosen,separators=(",",":"),allow_nan=False)+"\n")
    (output/"policy-mlp-evaluation.json").write_text(json.dumps(report,indent=2,allow_nan=False)+"\n")
    (output/"policy-mlp-parity.json").write_text(json.dumps({"modelSha256":model_hash,"steps":parity},separators=(",",":"),allow_nan=False)+"\n")
    print(json.dumps({"modelSha256":model_hash,"candidatePassed":report["acceptance"]["passed"],"baselineAccuracy":baseline["accuracy"],"seconds":report["runtime"]["seconds"]}))


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("graph",type=Path);parser.add_argument("output",type=Path)
    args=parser.parse_args();run(args.graph,args.output)
