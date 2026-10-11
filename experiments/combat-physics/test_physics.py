import hashlib,re,unittest
import numpy as np
import mujoco
from bvh import parse,local_pose,forward
from run import setup,run,SOURCE,EXPECTED,HINGES
class PhysicsTests(unittest.TestCase):
    def test_source_pinned_and_real_samples_separate_from_calibration(self):
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(),EXPECTED)
        b,f,dt=parse(SOURCE.read_text());self.assertGreater(len(f),960);self.assertAlmostEqual(dt,1/120,places=5)
        self.assertFalse(np.array_equal(f[0],f[1]));self.assertTrue(all(x.parent<i for i,x in enumerate(b)))
    def test_parser_rejects_nonfinite_and_truncated_frames(self):
        raw=SOURCE.read_text();self.assertRaises(ValueError,parse,raw.rsplit('\n',2)[0]);self.assertRaises(ValueError,parse,re.sub(r'Frame Time:\s*[^\n]+','Frame Time: nan',raw))
    def test_model_has_physical_hinges_and_uncontrolled_passive_bag(self):
        m,*_=setup()
        for name in HINGES:
            j=m.joint(name+'_joint');self.assertEqual(m.jnt_type[j.id],mujoco.mjtJoint.mjJNT_HINGE);np.testing.assert_allclose(m.jnt_range[j.id],[0,np.deg2rad(155)])
        self.assertGreater(m.nexclude,10);self.assertEqual(m.geom('LeftHand_geom').conaffinity[0],3);self.assertEqual(m.nu,0)
    def test_dynamic_repeat_contacts_and_quality_gates_remain_honest(self):
        a=run(False);b=run(False);ma=a['metrics'];mb=b['metrics'];self.assertEqual(ma['stateSha256'],mb['stateSha256']);self.assertEqual(ma['steps'],4800)
        self.assertGreater(ma['bagContactsOver1N'],0);self.assertGreater(ma['selfContactSamplesOver1N'],0);self.assertLessEqual(ma['maxNonRootGeneralizedTorqueNm'],95)
        self.assertTrue(ma['finite']);self.assertEqual(ma['qualityReady'],all(ma['qualityGates'].values()));self.assertFalse(ma['qualityReady'])
        self.assertEqual(len(a['frames']),480);self.assertTrue(any(np.linalg.norm(np.array(x['p'])-y['p'])>.02 for x,y in zip(a['frames'][-1]['bones'],a['frames'][-1]['reference'])))
if __name__=='__main__':unittest.main()
