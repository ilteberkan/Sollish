#!/usr/bin/env python3
"""Candidate asset invariants; these tests do not certify art or combat quality."""
import hashlib
import json
import math
import unittest
from pathlib import Path

from build_fightkit import HERE, ORIGINAL, PIN, build, load_glb, rows


class FightKit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base, cls.base_blob = load_glb(ORIGINAL)
        cls.path = HERE/'output/athlete-fightkit-v1.glb'
        cls.d, cls.blob = load_glb(cls.path)
        cls.manifest = json.loads((HERE/'output/manifest.json').read_text())

    def test_original_is_immutable_and_animation_binary_unchanged(self):
        self.assertEqual(hashlib.sha256(ORIGINAL.read_bytes()).hexdigest(), PIN)
        self.assertEqual(self.base['skins'], self.d['skins'])
        self.assertEqual(self.base['animations'], self.d['animations'])
        self.assertEqual(self.blob[:len(self.base_blob)], self.base_blob)
        for joint in self.base['skins'][0]['joints']:
            self.assertEqual(self.d['nodes'][joint], self.base['nodes'][joint])

    def test_manifest_and_licensed_resources_match_actual_bytes(self):
        self.assertEqual(self.manifest['sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(self.manifest['bytes'], self.path.stat().st_size)
        self.assertEqual(self.manifest['textureSource']['license'], 'CC0-1.0')
        self.assertFalse(self.manifest['motionCapture'])
        self.assertFalse(self.manifest['newAnatomy'])
        for source in self.manifest['textureSource']['files']:
            self.assertEqual(hashlib.sha256((HERE/'sources'/source['file']).read_bytes()).hexdigest(), source['sha256'])
        for view in self.d['bufferViews']:
            self.assertEqual(view.get('byteOffset', 0) % 4, 0)
            self.assertLessEqual(view.get('byteOffset', 0)+view['byteLength'], len(self.blob))
        self.assertFalse(any('uri' in x for x in self.d['images']+self.d['buffers']))

    def test_classic_referee_and_new_cast_visibility_can_be_selected(self):
        parent = next(n for n in self.d['nodes'] if n.get('name') == 'Armature')
        names = {self.d['nodes'][i]['name'] for i in parent['children']}
        self.assertTrue({'Trunks', 'Waistband', 'Boots', 'RefereeShirt', 'RefereeTrousers'} <= names)
        groups = [n for n in self.d['nodes'] if n.get('name', '').startswith('FightKit')]
        self.assertEqual(len(groups), 6)
        self.assertEqual(self.manifest['addedDrawGroups'], 6)
        self.assertTrue(all(n['skin'] == 0 and n['name'] in names for n in groups))
        self.assertTrue(self.d['extras']['requiresLegacyGlovesDisabled'])

    def test_new_geometry_finite_skinning_normalized_and_bounded(self):
        for mesh in self.d['meshes'][len(self.base['meshes']):]:
            a = mesh['primitives'][0]['attributes']
            self.assertEqual(set(a), {'POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'})
            data = {key: rows(self.d, self.blob, value) for key, value in a.items()}
            self.assertEqual(len(data['POSITION']) % 3, 0)
            self.assertEqual(len({len(value) for value in data.values()}), 1)
            self.assertTrue(all(math.isfinite(x) for value in data.values() for v in value for x in v))
            self.assertTrue(all(abs(sum(x*x for x in v)-1) < 1e-5 for v in data['NORMAL']))
            self.assertTrue(all(abs(sum(v)-1) < 1e-5 and min(v) >= 0 for v in data['WEIGHTS_0']))
            self.assertTrue(all(0 <= j < 65 for v in data['JOINTS_0'] for j in v))
            self.assertTrue(all(-1.01 <= v[0] <= 1.01 and -.03 <= v[1] <= 1.85 and -.3 <= v[2] <= .3 for v in data['POSITION']))

    def test_rebuild_is_deterministic_and_never_targets_public_original(self):
        previous = self.path.read_bytes()
        build()
        self.assertEqual(previous, self.path.read_bytes())
        self.assertEqual(hashlib.sha256(ORIGINAL.read_bytes()).hexdigest(), PIN)


if __name__ == '__main__':
    unittest.main(verbosity=2)
