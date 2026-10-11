import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

import numpy as np

from export_geometry import query_geometry


class GeometryRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = query_geometry()

    def test_loaded_colliders_match_independent_urdf_offsets_and_dimensions(self):
        import pybullet as p
        import pybullet_data
        raw = (Path(pybullet_data.getDataPath()) / "humanoid/humanoid.urdf").read_bytes()
        # The distributed file ends in NUL; preserve its original hash and strip
        # only terminal whitespace/NUL for the independent XML comparison.
        tree = ET.fromstring(raw.rstrip(b"\x00 \r\n"))
        links = {x.attrib["name"]: x for x in tree.findall("link")}
        self.assertEqual(len(self.data["geometry"]), 15)
        for shape in self.data["geometry"]:
            name = self.data["bones"][shape["bone"]]["name"]
            collision = links[name].find("collision")
            origin = collision.find("origin")
            pos = np.array([float(x) for x in origin.attrib.get("xyz", "0 0 0").split()]) * .25
            rot = p.getQuaternionFromEuler([float(x) for x in origin.attrib.get("rpy", "0 0 0").split()])
            np.testing.assert_allclose(shape["p"], pos, atol=1e-7)
            np.testing.assert_allclose(shape["q"], rot, atol=1e-7)
            node = collision.find("geometry")[0]
            if node.tag == "sphere":
                dimensions = [.25 * float(node.attrib["radius"])]
            elif node.tag == "box":
                dimensions = [.25 * float(x) for x in node.attrib["size"].split()]
            else:
                dimensions = [.25 * float(node.attrib["radius"]), .25 * float(node.attrib["length"])]
            self.assertEqual(shape["type"], node.tag)
            np.testing.assert_allclose(shape["dimensions"], dimensions, atol=1e-9)

    def test_rest_pose_is_zero_joint_hierarchy_not_motion_first_frame(self):
        data = self.data
        self.assertEqual(len(data["bones"]), 16)
        self.assertEqual(data["referenceRestPose"][0], {"p": [0, 0, 0], "q": [0, 0, 0, 1]})
        for i, bone in enumerate(data["bones"]):
            self.assertLess(bone["parent"], i)
            np.testing.assert_allclose(data["referenceRestPose"][i]["q"], [0,0,0,1], atol=1e-6)
        first = json.loads((Path(__file__).parent / "evidence/spinkick-240hz-10iterations-trace.json").read_text())["referencePose"]
        self.assertNotEqual(data["referenceRestPose"], first)
        # Exact queried pelvis offset and a foot's box are not inferred from
        # animated joint lines, which would omit the COM/shape offset.
        root = next(x for x in data["geometry"] if x["bone"] == 1)
        np.testing.assert_allclose(root["p"], [0,.07,0], atol=1e-7)
        foot = next(x for x in data["geometry"] if x["bone"] == 6)
        np.testing.assert_allclose(foot["dimensions"], [.177,.055,.09], atol=1e-9)


if __name__ == "__main__":
    unittest.main()
