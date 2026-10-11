"""Hash-gated TensorBundle numeric export, never a SavedModel or pickle load."""
import hashlib
import json
import os
from pathlib import Path
import sys

import numpy as np

from policy_numpy import Actor

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".tooling/combat-motor-reuse"
SOURCE = WORK / "pybullet-3.2.7/examples/pybullet/gym/pybullet_data"
EVIDENCE = Path(__file__).parent / "evidence"


def export(skill):
    if skill not in ("spinkick", "walk", "backflip"):
        raise ValueError("UNKNOWN_SKILL")
    rows = json.loads((EVIDENCE / "pybullet-artifacts.json").read_text())
    selected = [row for row in rows if "humanoid3d_" + skill + "." in row["path"]]
    if len(selected) != 3:
        raise ValueError("MANIFEST_SELECTION")
    for row in selected:
        path = SOURCE / row["path"]
        if path.stat().st_size != row["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError("ARTIFACT_HASH_MISMATCH")
    os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"
    sys.path.insert(0, str(WORK / "reader/tensorflow-checkpoint-reader-0.2.2"))
    from tensorflow_checkpoint_reader.py_checkpoint_reader import NewCheckpointReader
    reader = NewCheckpointReader(str(SOURCE / f"data/policies/humanoid3d/humanoid3d_{skill}.ckpt"))
    shapes = reader.get_variable_to_shape_map()
    if len(shapes) > 100 or sum(np.prod(shape, dtype=np.int64) for shape in shapes.values()) > 5_000_000:
        raise ValueError("TENSOR_BUDGET")
    values = {name: reader.get_tensor(name).copy() for name in shapes}
    if any(value.dtype.kind not in "fiu" or not np.isfinite(value).all() for value in values.values()):
        raise ValueError("NONNUMERIC_TENSOR")
    Actor(values)  # Fixed published architecture plus nonzero affine scalers.
    path = WORK / f"{skill}-numeric.npz"
    np.savez(path, **values)
    report = {"skill": skill, "inputFiles": selected,
              "reader": "tensorflow-checkpoint-reader0.2.2 with documented Python/NumPy compatibility aliases",
              "tensorShapes": {name: list(shape) for name, shape in shapes.items()},
              "outputSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "tensorCount": len(values), "finiteNumericOnly": True,
              "graphExecuted": False, "pickleUsed": False, "tensorflowInstalled": False}
    (EVIDENCE / f"{skill}-tensor-export.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    print(json.dumps(export(sys.argv[1] if len(sys.argv) > 1 else "spinkick"), indent=2))
