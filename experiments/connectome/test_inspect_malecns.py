"""Tiny synthetic Arrow files only; never downloads or needs the biological cache."""
import hashlib
from pathlib import Path
import tempfile
import unittest

try:
    import pyarrow as pa
except ImportError:
    pa = None
if pa is not None:
    from inspect_malecns import InspectionError, inspect_table, scan_weights


@unittest.skipIf(pa is None, "optional hash-pinned PyArrow inspection environment is not installed")
class ArrowInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "synthetic.feather"

    def write(self, columns, types=None):
        schema = pa.schema([(key, (types or {}).get(key, pa.int64())) for key in columns])
        table = pa.table(columns, schema=schema)
        with pa.OSFile(str(self.path), "wb") as out:
            with pa.ipc.new_file(out, schema) as writer:
                writer.write_table(table, max_chunksize=2)
        return hashlib.sha256(self.path.read_bytes()).hexdigest()

    def scan(self, columns):
        digest = self.write(columns)
        return scan_weights(self.path, digest, pa.array([1, 2], type=pa.int64()))

    def test_integer_weights_and_id_preservation_without_silent_aggregation(self):
        result = self.scan({"body_pre": [1, 1, 2, 99], "body_post": [2, 2, 2, 1], "weight": [3, 4, 8, 11]})
        self.assertEqual(result["rows"], 4)
        self.assertEqual(result["summed_integer_weights"], 26)
        self.assertEqual(result["traced_endpoint_view"]["edge_rows"], 3)
        self.assertEqual(result["traced_endpoint_view"]["summed_integer_weights"], 15)
        self.assertEqual(result["self_loop_rows"], 1)
        self.assertFalse(result["csr_created"])
        self.assertIn("not-tested", result["duplicate_pairs"])

    def test_wrong_hash_rejected_before_arrow_parse(self):
        self.path.write_bytes(b"not an Arrow file")
        with self.assertRaisesRegex(InspectionError, "SOURCE_HASH_MISMATCH"):
            scan_weights(self.path, "0" * 64, pa.array([1], type=pa.int64()))

    def test_noninteger_weight_schema_rejected(self):
        digest = self.write({"body_pre": [1], "body_post": [2], "weight": [1.5]}, {"weight": pa.float64()})
        with self.assertRaisesRegex(InspectionError, "WEIGHTS_SCHEMA"):
            scan_weights(self.path, digest, pa.array([1], type=pa.int64()))

    def test_null_negative_and_large_weights_rejected(self):
        for value, code in [(None, "NULL_WEIGHT_OR_ENDPOINT"), (0, "INVALID_WEIGHT"), (-1, "INVALID_WEIGHT"), (1_000_000_001, "INVALID_WEIGHT")]:
            with self.subTest(value=value), self.assertRaisesRegex(InspectionError, code):
                self.scan({"body_pre": [1], "body_post": [2], "weight": [value]})

    def test_missing_and_invalid_endpoint_rejected(self):
        for value, code in [(None, "NULL_WEIGHT_OR_ENDPOINT"), (0, "INVALID_ID"), (-1, "INVALID_ID")]:
            with self.subTest(value=value), self.assertRaisesRegex(InspectionError, code):
                self.scan({"body_pre": [value], "body_post": [2], "weight": [1]})

    def test_metadata_counts_and_nullable_status_preserved(self):
        digest = self.write({"bodyId": [1, 2, 3], "status": ["Traced", None, "Glia"]}, {"status": pa.string()})
        info, table = inspect_table(self.path, digest, "bodyId")
        self.assertEqual(info["rows"], 3)
        self.assertEqual(table["status"].to_pylist(), ["Traced", None, "Glia"])


if __name__ == "__main__":
    unittest.main()
