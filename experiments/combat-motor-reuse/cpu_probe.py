"""Actual Newton native-MuJoCo CPU probe; deliberately no learned-policy claim."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import time

import newton
import numpy as np
import warp as wp

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".tooling/combat-motor-reuse"
EVIDENCE = Path(__file__).parent / "evidence"


def run() -> dict:
    EVIDENCE.mkdir(exist_ok=True)
    provenance = json.loads((WORK / "source-provenance.json").read_text())
    row = next(r for r in provenance if r["path"] == "data/assets/humanoid/humanoid.xml")
    source = WORK / "source" / row["path"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != row["sha256"]:
        raise ValueError("SOURCE_HASH_MISMATCH")
    wp.config.kernel_cache_dir = str(WORK / "warp-cache")
    wp.config.enable_backward = False
    wp.init()
    wp.set_device("cpu")
    started = time.perf_counter()
    builder = newton.ModelBuilder()
    newton.solvers.SolverMuJoCo.register_custom_attributes(builder)
    builder.default_shape_cfg.mu = 1.0
    builder.add_ground_plane(cfg=builder.ShapeConfig(mu=1.0, restitution=0))
    # The same import flags as the pinned MimicKit NewtonEngine. This is a
    # diagnostic passive fall, not the unavailable spinkick initial state.
    builder.add_mjcf(str(source), floating=True, ignore_inertial_definitions=False,
                     collapse_fixed_joints=False, enable_self_collisions=True,
                     convert_3d_hinge_to_ball_joints=True,
                     xform=wp.transform(wp.vec3(0, 0, 1.05), wp.quat_identity()))
    model = builder.finalize(device="cpu", requires_grad=False)
    # No controller or invisible root support. Keep source passive joint terms.
    model.joint_target_ke.zero_()
    model.joint_target_kd.zero_()
    model.joint_target_mode.fill_(int(newton.JointTargetMode.NONE))
    state, next_state = model.state(), model.state()
    newton.eval_fk(model, model.joint_q, model.joint_qd, state)
    control, contacts = model.control(), model.contacts()
    solver = newton.solvers.SolverMuJoCo(
        model, use_mujoco_cpu=True, solver="newton", njmax=450,
        nconmax=150, impratio=10, iterations=100, ls_iterations=50,
    )
    initialized = time.perf_counter()
    frames = []
    latencies = []
    for step in range(1200):
        state.clear_forces()
        t = time.perf_counter()
        solver.step(state, next_state, control, contacts, 1 / 240)
        state, next_state = next_state, state
        wp.synchronize_device("cpu")
        latencies.append(time.perf_counter() - t)
        if step % 8 == 7:
            q = state.body_q.numpy()
            if not np.isfinite(q).all():
                raise ValueError("NONFINITE_PHYSICS")
            frames.append({"t": (step + 1) / 240, "bodies": q.tolist()})
    finished = time.perf_counter()
    try:
        # MimicKit's pinned NewtonEngine.step calls this exact API after each
        # control tick. Test it separately rather than claiming full integration.
        solver.update_contacts(contacts, state)
        contact_bridge = {"status": "PASS", "exception": None}
    except NotImplementedError:
        contact_bridge = {"status": "BLOCKED", "exception": "NotImplementedError"}
    trace = {"schema": "sollish-newton-cpu-probe-v1", "units": "metres",
             "upAxis": "Z", "quaternion": "xyzw", "bodyNames": model.body_label,
             "sourceSha256": row["sha256"], "frames": frames,
             "controller": "NONE_PASSIVE_FALL_NOT_A_TRAINED_MOTOR"}
    raw = (json.dumps(trace, separators=(",", ":"), allow_nan=False) + "\n").encode()
    (EVIDENCE / "passive-trace.json").write_bytes(raw)
    result = {
        "schema": "sollish-motor-reuse-runtime-v1", "device": "cpu",
        "host": {"system": platform.system(), "machine": platform.machine(),
                 "python": platform.python_version()},
        "versions": {name: importlib.metadata.version(name) for name in
                     ["newton", "warp-lang", "mujoco", "mujoco-warp", "numpy"]},
        "runtime": "PASS", "learnedInference": "BLOCKED_MODEL_DOWNLOAD_AUTH",
        "mimickitRequiredContactBridge": contact_bridge,
        "controller": "none", "secondsSimulated": 5, "steps": 1200,
        "bodies": model.body_count, "dofs": model.joint_dof_count,
        "initializationSeconds": initialized - started,
        "steppingSeconds": finished - initialized,
        "stepP50Ms": float(np.quantile(latencies, .50) * 1000),
        "stepP95Ms": float(np.quantile(latencies, .95) * 1000),
        "traceSha256": hashlib.sha256(raw).hexdigest(), "traceBytes": len(raw),
        "finite": True, "qualityEvaluated": False,
        "limitations": ["No weights or motion loaded; no policy inference.",
                        "A passive fall only proves this CPU backend can step this model.",
                        "No balancing, combat, visual quality or live-game readiness claim.",
                        "Not the full MimicKit agent/environment path."],
    }
    (EVIDENCE / "cpu-runtime.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
