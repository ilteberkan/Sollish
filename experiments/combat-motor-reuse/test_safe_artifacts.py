import hashlib
import os
from pathlib import Path
import pickle
import tempfile
import unittest

from safe_artifacts import checked_bytes, motion_data


def fixture(**overrides):
    data = {"loop_mode": 1, "fps": 30, "frames": [[0.] * 34, [.01] * 34]}
    data.update(overrides)
    return pickle.dumps(data, protocol=4)


class SafeArtifacts(unittest.TestCase):
    def test_official_builtin_motion_format(self):
        self.assertEqual(len(motion_data(fixture())["frames"][0]), 34)

    def test_pickle_callable_never_executes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "must-not-exist"
            class Evil:
                def __reduce__(self):
                    return os.system, (f"touch {path}",)
            with self.assertRaisesRegex(ValueError, "OPCODE"):
                motion_data(pickle.dumps(Evil()))
            self.assertFalse(path.exists())

    def test_malformed_motion_rejected(self):
        for change in [dict(fps=True), dict(fps=float("nan")), dict(loop_mode=3),
                       dict(frames=[]), dict(frames=[[0.] * 6, [0.]]),
                       dict(frames=[[0.] * 6, [float("inf")] * 6])]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                motion_data(fixture(**change))

    def test_trailing_payload_rejected(self):
        with self.assertRaisesRegex(ValueError, "TRAILING"):
            motion_data(fixture() + b"extra")

    def test_hash_and_byte_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model"
            path.write_bytes(b"123")
            sha = hashlib.sha256(b"123").hexdigest()
            self.assertEqual(checked_bytes(path, sha, 3), b"123")
            with self.assertRaisesRegex(ValueError, "TOO_LARGE"):
                checked_bytes(path, sha, 2)
            with self.assertRaisesRegex(ValueError, "HASH_MISMATCH"):
                checked_bytes(path, "0" * 64, 3)


if __name__ == "__main__":
    unittest.main()
