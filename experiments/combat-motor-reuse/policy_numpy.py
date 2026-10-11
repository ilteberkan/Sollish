"""Numeric evaluation of the published PyBullet DeepMimic mean actor.

Same two ReLU hidden layers and affine normalizers as learning/pg_agent.py;
no retraining, resampling, outcome input, graph execution or TensorFlow import.
"""
import numpy as np


class Actor:
    def __init__(self, tensors):
        self.t = tensors
        self.prefix = "agent/main/actor/"
        dimensions = [(197, 1024), (1024, 512), (512, 36)]
        for name, shape in zip(["0/dense", "1/dense", "dense"], dimensions):
            self._check(self.prefix + name + "/kernel", shape)
            self._check(self.prefix + name + "/bias", (shape[1],))
        for name, size in [("s", 197), ("a", 36)]:
            for part in ["mean", "std"]:
                self._check(f"agent/resource/{name}_norm/{part}", (size,))
            if np.any(tensors[f"agent/resource/{name}_norm/std"] <= 0):
                raise ValueError("NORMALIZER_NONPOSITIVE")

    def _check(self, key, shape):
        value = self.t[key]
        if value.shape != shape or value.dtype != np.float32 or not np.isfinite(value).all():
            raise ValueError("TENSOR_SCHEMA:" + key)

    def __call__(self, state):
        x = np.asarray(state, dtype=np.float32)
        if x.shape != (197,) or not np.isfinite(x).all():
            raise ValueError("OBSERVATION_SCHEMA")
        x = (x - self.t["agent/resource/s_norm/mean"]) / self.t["agent/resource/s_norm/std"]
        for name in ["0/dense", "1/dense"]:
            x = np.maximum(x @ self.t[self.prefix + name + "/kernel"]
                           + self.t[self.prefix + name + "/bias"], 0)
        x = x @ self.t[self.prefix + "dense/kernel"] + self.t[self.prefix + "dense/bias"]
        action = x * self.t["agent/resource/a_norm/std"] + self.t["agent/resource/a_norm/mean"]
        if not np.isfinite(action).all():
            raise ValueError("NONFINITE_ACTION")
        return action
