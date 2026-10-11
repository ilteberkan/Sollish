import contextlib
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import validate_dataset as validator


class DatasetValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for file in (Path(__file__).parent / "fixtures").iterdir():
            shutil.copyfile(file, self.root / file.name)
        self.path = self.root / "manifest.json"
        self.manifest = json.loads(self.path.read_text())

    def tearDown(self):
        self.temporary.cleanup()

    def write(self):
        self.path.write_text(json.dumps(self.manifest))

    def replace_csv(self, key, content):
        path = self.root / self.manifest["files"][key]["path"]
        path.write_text(content)
        self.manifest["files"][key]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.write()

    def reject(self, code):
        with self.assertRaises(validator.ValidationError) as caught:
            validator.validate_manifest(self.path)
        self.assertEqual(str(caught.exception), code)

    def test_fixture_is_explicit_and_never_production_ready(self):
        result = validator.validate_manifest(self.path)
        self.assertEqual(result["validation"], "VALID_SYNTHETIC_FIXTURE")
        self.assertEqual((result["neurons"], result["edges"], result["total_synapse_count"]), (4, 4, 19))
        for key in ("production_ready", "trained_policy_present", "consciousness_evidence"):
            self.assertIs(result[key], False)
        self.assertEqual(result["commercial_permission"], "unresolved")

    def test_tampering_is_rejected_before_csv_is_used(self):
        (self.root / "edges.csv").write_text("SECRET_PAYLOAD")
        self.reject("HASH_MISMATCH")

    def test_missing_endpoint_and_duplicate_edge_are_rejected(self):
        self.replace_csv("edges", "pre_id,post_id,synapse_count\n1,2,5\n1,3,7\n2,4,3\n3,99,4\n")
        self.reject("UNKNOWN_ENDPOINT")
        self.replace_csv("edges", "pre_id,post_id,synapse_count\n1,2,5\n1,3,7\n2,4,3\n2,4,4\n")
        self.reject("DUPLICATE_EDGE")

    def test_synapse_counts_cannot_be_negative_fractional_zero_or_nonfinite(self):
        for invalid in ("-1", "0", "1.5", "NaN", "Infinity", "01", "1000000000"):
            with self.subTest(invalid=invalid):
                self.replace_csv("edges", f"pre_id,post_id,synapse_count\n1,2,{invalid}\n1,3,7\n2,4,3\n3,4,4\n")
                self.reject("INVALID_SYNAPSE_COUNT")

    def test_ids_remain_exact_uint64_not_float_or_duplicate(self):
        for invalid in ("0", "01", "1.0", "1e3", str(1 << 64)):
            with self.subTest(invalid=invalid):
                self.replace_csv("neurons", f"neuron_id,cell_type,nt_type\n{invalid},test,unknown\n2,test,gaba\n3,test,unknown\n4,test,acetylcholine\n")
                self.reject("INVALID_NEURON_ID")
        self.replace_csv("neurons", "neuron_id,cell_type,nt_type\n1,test,unknown\n1,test,gaba\n3,test,unknown\n4,test,acetylcholine\n")
        self.reject("DUPLICATE_NEURON")

    def test_unknown_columns_ragged_rows_and_unknown_nt_are_rejected(self):
        self.replace_csv("neurons", "neuron_id,cell_type,nt_type,extra\n1,a,unknown,ignored\n")
        self.reject("INVALID_COLUMNS")
        self.replace_csv("neurons", "neuron_id,cell_type,nt_type\n1,a\n")
        self.reject("INVALID_ROW")
        self.replace_csv("neurons", "neuron_id,cell_type,nt_type\n1,a,unknown\n2,b,positive\n3,c,unknown\n4,d,unknown\n")
        self.reject("INVALID_NEUROTRANSMITTER")

    def test_count_and_whole_brain_import_limits(self):
        self.manifest["expected"]["neurons"] = 5
        self.write(); self.reject("COUNT_MISMATCH")
        self.manifest["expected"]["neurons"] = 139255
        self.write(); self.reject("NEURON_LIMIT")
        self.manifest["expected"]["neurons"] = True
        self.write(); self.reject("NEURON_LIMIT")

    def test_csv_actual_limit_cannot_be_bypassed_by_manifest_count(self):
        with patch.object(validator, "MAX_EDGES", 4):
            self.replace_csv("edges", "pre_id,post_id,synapse_count\n1,2,5\n1,3,7\n2,4,3\n3,4,4\n4,4,1\n")
            self.reject("ROW_LIMIT")

    def test_paths_cannot_escape_manifest_directory(self):
        for unsafe in ("../outside.csv", "/etc/passwd", "sub/../edges.csv", "./edges.csv", "C:\\file", "sub//edges.csv"):
            with self.subTest(unsafe=unsafe):
                self.manifest["files"]["edges"]["path"] = unsafe
                self.write(); self.reject("UNSAFE_PATH")

    def test_symlink_leaf_and_directory_are_not_followed(self):
        (self.root / "linked.csv").symlink_to(self.root / "edges.csv")
        self.manifest["files"]["edges"]["path"] = "linked.csv"
        self.write()
        with self.assertRaises(OSError): validator.validate_manifest(self.path)
        (self.root / "linked-dir").symlink_to(self.root, target_is_directory=True)
        self.manifest["files"]["edges"]["path"] = "linked-dir/edges.csv"
        self.write()
        with self.assertRaises(OSError): validator.validate_manifest(self.path)

    def test_file_size_is_bounded_before_read(self):
        with patch.object(validator, "MAX_FILE_BYTES", 12):
            self.reject("FILE_TOO_LARGE")

    def test_flywire_cannot_be_relabelled_as_commercial_cc_by(self):
        self.manifest["dataset"].update(kind="flywire-fafb", release="783", is_synthetic=False)
        self.manifest["provenance"].update(source_url="https://codex.flywire.ai/api/download?dataset=fafb", license_id="CC-BY-4.0", license_url="https://flywire.ai/guidelines")
        self.write(); self.reject("SOURCE_LICENSE_MISMATCH")

    def test_fixture_cannot_hide_as_a_measured_brain(self):
        self.manifest["dataset"]["is_synthetic"] = False
        self.write(); self.reject("FIXTURE_MISLABELLED")

    def test_production_or_consciousness_claim_is_rejected(self):
        for key, value in (("commercial_permission", "approved"), ("financial_integration", True), ("consciousness_claim", True), ("biological_fidelity", "validated"), ("financial_integration", 0)):
            with self.subTest(key=key, value=value):
                before = self.manifest["usage"][key]
                self.manifest["usage"][key] = value
                self.write(); self.reject("PRODUCTION_GATE")
                self.manifest["usage"][key] = before

    def test_duplicate_json_keys_nan_and_extra_fields_fail_closed(self):
        self.path.write_text('{"schema_version":1,"schema_version":1}')
        self.reject("DUPLICATE_JSON_KEY")
        self.path.write_text('{"schema_version":NaN}')
        self.reject("INVALID_JSON_NUMBER")
        self.manifest["fake_approved"] = True
        self.write(); self.reject("MANIFEST_SHAPE")

    def test_cli_reports_fixed_code_without_sensitive_input(self):
        self.path.write_text("SECRET_DATASET_CONTENT_DO_NOT_ECHO")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = validator.main([str(self.path)])
        self.assertEqual(code, 1)
        self.assertNotIn("SECRET_DATASET", output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["code"], "INVALID_JSON")

    def test_graph_fingerprint_is_order_independent_but_file_hash_is_not(self):
        first = validator.validate_manifest(self.path)
        self.replace_csv("edges", "pre_id,post_id,synapse_count\n3,4,4\n2,4,3\n1,3,7\n1,2,5\n")
        second = validator.validate_manifest(self.path)
        self.assertEqual(first["graph_sha256"], second["graph_sha256"])
        self.assertNotEqual(first["manifest_sha256"], second["manifest_sha256"])


if __name__ == "__main__":
    unittest.main()
