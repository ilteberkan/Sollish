"""Fail-closed data-only loaders for a future authenticated/author asset delivery.

No downloads, network calls, classes, numpy reconstruction or arbitrary pickle
globals. The official Motion.save emits builtin dict/list/numeric containers.
"""
from __future__ import annotations

import hashlib
from collections import OrderedDict
import io
import math
from pathlib import Path
import pickle
import pickletools
import re

MAX_MOTION_BYTES = 16_000_000
MAX_WEIGHTS_BYTES = 100_000_000


def checked_bytes(path: Path, expected_sha256: str, limit: int) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("EXPECTED_SHA256_REQUIRED")
    with path.open("rb") as file:
        raw = file.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("ARTIFACT_TOO_LARGE")
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError("ARTIFACT_HASH_MISMATCH")
    return raw


class _BuiltinOnly(pickle.Unpickler):
    def find_class(self, module, name):
        raise ValueError("PICKLE_GLOBAL_FORBIDDEN")

    def persistent_load(self, pid):
        raise ValueError("PICKLE_PERSISTENT_ID_FORBIDDEN")


def motion_data(raw: bytes) -> dict:
    if len(raw) > MAX_MOTION_BYTES:
        raise ValueError("MOTION_TOO_LARGE")
    forbidden = {"GLOBAL", "STACK_GLOBAL", "REDUCE", "BUILD", "INST", "OBJ",
                 "NEWOBJ", "NEWOBJ_EX", "EXT1", "EXT2", "EXT4", "PERSID", "BINPERSID"}
    for op, _arg, _position in pickletools.genops(raw):
        if op.name in forbidden:
            raise ValueError("PICKLE_EXECUTION_OPCODE_FORBIDDEN")
    stream = io.BytesIO(raw)
    value = _BuiltinOnly(stream).load()
    if stream.read(1):
        raise ValueError("TRAILING_PICKLE_BYTES")
    if type(value) is not dict or set(value) != {"loop_mode", "fps", "frames"}:
        raise ValueError("MOTION_SCHEMA")
    if type(value["loop_mode"]) is not int or value["loop_mode"] not in (0, 1):
        raise ValueError("LOOP_MODE")
    fps = value["fps"]
    if type(fps) not in (int, float) or not math.isfinite(fps) or not 1 <= fps <= 240:
        raise ValueError("FPS")
    rows = value["frames"]
    if type(rows) is not list or not 2 <= len(rows) <= 10_000:
        raise ValueError("FRAME_COUNT")
    width = len(rows[0]) if type(rows[0]) is list else 0
    if not 6 <= width <= 256:
        raise ValueError("FRAME_WIDTH")
    for row in rows:
        if type(row) is not list or len(row) != width:
            raise ValueError("RAGGED_FRAMES")
        for number in row:
            if (type(number) not in (int, float) or not math.isfinite(number)
                    or abs(number) > 10_000):
                raise ValueError("FRAME_NUMBER")
    return value


def load_weights(path: Path, expected_sha256: str):
    """Do not call without a licensed, separately reviewed known model hash."""
    raw = checked_bytes(path, expected_sha256, MAX_WEIGHTS_BYTES)
    import torch  # Optional; not installed just to substitute random weights.
    state = torch.load(io.BytesIO(raw), map_location="cpu", weights_only=True)
    if type(state) not in (dict, OrderedDict) or not state or len(state) > 10_000:
        raise ValueError("STATE_DICT_SCHEMA")
    elements = 0
    for key, tensor in state.items():
        if type(key) is not str or len(key) > 256 or not isinstance(tensor, torch.Tensor):
            raise ValueError("STATE_DICT_ENTRY")
        elements += tensor.numel()
        if elements > 25_000_000 or not torch.isfinite(tensor).all():
            raise ValueError("STATE_DICT_BOUNDS")
    return state
