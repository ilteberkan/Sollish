"""Free-base learned PyBullet motor rollout. Existing CMU evidence is untouched."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import sys
import time
import types

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
import numpy as np

from export_checkpoint import WORK, EVIDENCE
from policy_numpy import Actor


def run(skill="spinkick", seconds=10, hz=240, iterations=10):
    if skill not in ("spinkick", "walk", "backflip") or not 1 <= seconds <= 10 or hz not in (240, 600, 1200) or iterations not in (10, 50):
        raise ValueError("ROLLOUT_BOUNDS")
    import pybullet as p
    import pybullet_data
    from pybullet_utils import bullet_client
    from pybullet_utils.arg_parser import ArgParser
    # Avoid executing unrelated legacy Gym registration from the package root.
    package = types.ModuleType("pybullet_envs")
    package.__path__ = [str(Path(pybullet_data.__file__).parent.parent / "pybullet_envs")]
    sys.modules.setdefault("pybullet_envs", package)
    from pybullet_envs.deep_mimic.env.pybullet_deep_mimic_env import PyBulletDeepMimicEnv, InitializationStrategy
    Client = bullet_client.BulletClient
    # The upstream default tries SHARED_MEMORY. Force an isolated DIRECT world.
    bullet_client.BulletClient = lambda *a, **kw: Client(connection_mode=p.DIRECT)
    export = json.loads((EVIDENCE / f"{skill}-tensor-export.json").read_text())
    path = WORK / f"{skill}-numeric.npz"
    if hashlib.sha256(path.read_bytes()).hexdigest() != export["outputSha256"]:
        raise ValueError("NPZ_HASH_MISMATCH")
    with np.load(path, allow_pickle=False) as loaded:
        actor = Actor({key: loaded[key] for key in loaded.files})
    arguments = ArgParser()
    arguments.load_file(str(Path(pybullet_data.getDataPath()) / f"args/run_humanoid3d_{skill}_args.txt"))
    env = PyBulletDeepMimicEnv(arguments, enable_draw=False, time_step=1/hz,
                             init_strategy=InitializationStrategy.START)
    client, humanoid = env._pybullet_client, env._humanoid
    client.setPhysicsEngineParameter(numSolverIterations=iterations)
    sim, reference = humanoid._sim_model, humanoid._kin_model
    count = client.getNumJoints(sim)
    bones = [{"name": "base", "parent": -1}]
    for j in range(count):
        info = client.getJointInfo(sim, j)
        bones.append({"name": info[12].decode(), "parent": info[16] + 1})

    def snapshot(body):
        pos, rot = client.getBasePositionAndOrientation(body)
        result = [{"p": list(pos), "q": list(rot)}]
        states = client.getLinkStates(body, list(range(count)), computeForwardKinematics=True)
        # World link origins, not centres of mass. Same indices/hierarchy as URDF.
        result += [{"p": list(s[4]), "q": list(s[5])} for s in states]
        return result

    first_ref = snapshot(reference)
    frames, errors, root_relative_errors, foot_speeds, contact_slips, heights, latency = [], [], [], [], [], [], []
    max_pen, first_fall, action_count, prior_foot = 0., None, 0, None
    action_times = []
    initial_mass = client.getDynamicsInfo(sim, -1)[0]
    started = time.perf_counter()
    try:
        for step in range(seconds * hz):
            # 240 Hz reproduces the published testrl.py timestep and scheduler.
            # Earlier 600/1200 Hz experiments retain their fixed 30 Hz schedule.
            if env.need_new_action(0) if hz == 240 else step % (hz // 30) == 0:
                state = env.record_state(0)
                before = time.perf_counter()
                action = actor(state)
                latency.append(time.perf_counter() - before)
                env.set_action(0, action.tolist())
                action_count += 1
                action_times.append(env.t)
            env.update(1/hz)
            body, ref = snapshot(sim), snapshot(reference)
            bp, rp = np.array([x["p"] for x in body]), np.array([x["p"] for x in ref])
            heights.append(float(bp[0,1]))
            if not np.isfinite(bp).all():
                raise ValueError("NONFINITE_BODY")
            errors.append(float(np.linalg.norm(bp[1:] - rp[1:], axis=1).mean()))
            root_relative_errors.append(float(np.linalg.norm((bp[1:] - bp[0]) - (rp[1:] - rp[0]), axis=1).mean()))
            contacts, supported = [], set()
            for c in client.getContactPoints(bodyA=sim):
                max_pen = max(max_pen, -c[8])
                if c[2] == env._planeId and c[9] > 1 and c[3] in (5, 11):
                    supported.add(c[3])
                    link = client.getLinkState(sim, c[3], computeLinkVelocity=True)
                    # A rolling foot's ankle can move while its contact patch
                    # remains planted. Keep this diagnostic separate from the
                    # original ankle-speed gate; never silently substitute it.
                    at_contact = np.array(link[6]) + np.cross(link[7], np.array(c[5]) - link[0])
                    contact_slips.append(float(np.linalg.norm(at_contact[[0,2]])))
                if step % (hz//60) == 0:
                    contacts.append({"p": list(c[5]), "force": c[9], "bodyA": c[3], "bodyB": c[4]})
            foot = bp[[6, 12]]
            if prior_foot is not None:
                for i, link in enumerate((5, 11)):
                    if link in supported:
                        foot_speeds.append(float(np.linalg.norm((foot[i] - prior_foot[i])[[0,2]]) * hz))
            prior_foot = foot.copy()
            if first_fall is None and humanoid.terminates():
                first_fall = (step + 1) / hz
            if step % (hz//60) == 0:
                frames.append({"t": (step+1)/hz, "bones": body, "reference": ref, "contacts": contacts})
    finally:
        client.disconnect()
    metrics = {"physicsHz": hz, "solverIterations": iterations, "seconds": seconds,
               "runtimeSeconds": time.perf_counter()-started,
               "modelSha256": next(x["sha256"] for x in export["inputFiles"] if ".data-" in x["path"]),
               "motionSha256": next(x["sha256"] for x in export["inputFiles"] if "/motions/" in x["path"]),
               "controlSchedule": "upstream env.need_new_action floating clock" if hz == 240 else "fixed 30Hz experiment",
               "actionIntervalMinSeconds": min(np.diff(action_times)),
               "actionIntervalMaxSeconds": max(np.diff(action_times)),
               "initialization": "START at phase zero; upstream also supports RANDOM",
               "controller": "published learned mean actor + upstream joint stable PD",
               "freeBaseMass": initial_mass, "rootAssistApplied": False,
               "p95JointPositionErrorMeters": float(np.percentile(errors,95)),
               "p95RootRelativeJointPositionErrorMeters": float(np.percentile(root_relative_errors,95)),
               "maxContactPenetrationMeters": max_pen,
               "p95SupportedFootHorizontalSpeedMps": float(np.percentile(foot_speeds,95)) if foot_speeds else None,
               "p95FootContactPointHorizontalSpeedMps": float(np.percentile(contact_slips,95)) if contact_slips else None,
               "baseHeightMinMeters": min(heights), "baseHeightMaxMeters": max(heights),
               "firstDisallowedGroundContactSeconds": first_fall,
               "actionCount": action_count, "inferenceP50Ms": float(np.percentile(latency,50)*1000),
               "inferenceP95Ms": float(np.percentile(latency,95)*1000),
               "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
               "finite": True}
    metrics["qualityGates"] = {
        "trackingP95Under5cm": metrics["p95JointPositionErrorMeters"] < .05,
        "penetrationUnder5mm": max_pen < .005,
        "supportedFootSpeedP95Under10cmps": bool(foot_speeds) and metrics["p95SupportedFootHorizontalSpeedMps"] < .1,
    }
    metrics["independentBalanceObserved"] = first_fall is None
    metrics["qualityReady"] = all(metrics["qualityGates"].values()) and first_fall is None
    label = f"{skill}-{hz}hz-{iterations}iterations"
    trace = {"schema": "sollish-learned-motor-trace-v1", "engine": "PyBullet3.2.7",
             "upAxis": "Y", "units": "metres", "quaternion": "xyzw", "skill": skill,
             "bones": bones, "referencePose": first_ref, "frames": frames, "metrics": metrics,
             "limitations": ["Single pretrained motor skill, no opponent or learned combat strategy.",
                             "PyBullet port; not proven bit-identical to the author's original C++ runtime.",
                             "No pelvic support or external root force; target ghost is collision-disabled.",
                             "Separate source from CMU13_18: does not change any earlier failed quality gate."]}
    raw = (json.dumps(trace,separators=(",",":"),allow_nan=False)+"\n").encode()
    (EVIDENCE / f"{label}-trace.json").write_bytes(raw)
    metrics["traceSha256"] = hashlib.sha256(raw).hexdigest()
    (EVIDENCE / f"{label}-metrics.json").write_text(json.dumps(metrics,indent=2)+"\n")
    print(json.dumps(metrics,indent=2))
    return metrics


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--skill", choices=["spinkick","walk","backflip"], default="spinkick")
    args.add_argument("--seconds",type=int,default=10)
    args.add_argument("--hz",type=int,default=240)
    args.add_argument("--iterations",type=int,default=10)
    options=args.parse_args()
    run(options.skill,options.seconds,options.hz,options.iterations)
