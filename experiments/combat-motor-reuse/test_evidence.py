import copy
import json
from pathlib import Path
import unittest

from validate_evidence import validate


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.trace = json.loads((Path(__file__).parent / "evidence/walk-240hz-10iterations-render-trace.json").read_text())

    def test_actual_trace_stays_quality_failed(self):
        result = validate(self.trace)
        self.assertFalse(result["qualityReady"])
        self.assertTrue(result["independentBalanceObserved"])

    def test_rejects_faked_quality_or_rest_pose(self):
        for field, value in [("qualityReady", True), ("rootAssistApplied", True)]:
            trace = copy.deepcopy(self.trace); trace["metrics"][field] = value
            with self.assertRaises(ValueError): validate(trace)
        trace = copy.deepcopy(self.trace); trace["referenceRestPose"] = trace["referencePose"]
        with self.assertRaises(ValueError): validate(trace)

    def test_rejects_bad_geometry_hierarchy_and_nonfinite_body(self):
        for change in [lambda t: t["geometry"][0].update(dimensions=[-1]),
                       lambda t: t["bones"][2].update(parent=2),
                       lambda t: t["metrics"].update(maxContactPenetrationMeters=float("nan")),
                       lambda t: t["frames"][5]["bones"][1].update(p=[float("nan"),0,0])]:
            trace = copy.deepcopy(self.trace); change(trace)
            with self.assertRaises(ValueError): validate(trace)


if __name__ == "__main__":
    unittest.main()
