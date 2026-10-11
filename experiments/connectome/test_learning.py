"""Learning/provenance tests; synthetic optimizer fixture is explicitly nonbiological."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from export_policy import export

try:
    import numpy as np
except ImportError:
    np=None
if np is not None:
    from train_policy import TRAIN_SEEDS, VALIDATION_SEEDS, TEST_SEEDS, episodes, reservoir, features
    from train_nonlinear_policy import FINAL_TEST_SEEDS, fit_head, scores

HERE=Path(__file__).parent


class PolicyArtifactTests(unittest.TestCase):
    def test_real_subgraph_has_exact_integer_ids_weights_and_recorded_hash(self):
        graph=json.loads((HERE/'evidence/descending-128.json').read_text())
        actual=hashlib.sha256(json.dumps(graph['graph'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(actual,graph['graphSha256'])
        ids=[node['bodyId'] for node in graph['graph']['nodes']]
        self.assertEqual(ids,sorted(set(ids)));self.assertEqual(len(ids),128)
        self.assertTrue(all(node['status']=='Traced' and node['superclass']=='descending_neuron' for node in graph['graph']['nodes']))
        edges=graph['graph']['edges'];self.assertEqual(len(edges),graph['edgeCount'])
        self.assertTrue(all(a in ids and b in ids and type(w) is int and w>0 for a,b,w in edges))
        self.assertEqual(sum(w for _,_,w in edges),graph['summedWeights'])
        self.assertFalse(graph['wholeBrain'])

    def test_export_rejects_tampered_model_or_failed_acceptance_without_overwriting(self):
        model=json.loads((HERE/'evidence/policy-mlp-model.json').read_text())
        report=json.loads((HERE/'evidence/policy-mlp-evaluation.json').read_text())
        with tempfile.TemporaryDirectory() as name:
            directory=Path(name);mp=directory/'model.json';rp=directory/'report.json';out=directory/'output.ts'
            out.write_text('preserve')
            model['head']['b2'][0]+=1;mp.write_text(json.dumps(model));rp.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,'MODEL_NOT_ACCEPTED_OR_HASH_MISMATCH'):export(mp,rp,out)
            self.assertEqual(out.read_text(),'preserve')
            model=json.loads((HERE/'evidence/policy-mlp-model.json').read_text());mp.write_text(json.dumps(model))
            report['acceptance']['passed']=False;rp.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,'MODEL_NOT_ACCEPTED_OR_HASH_MISMATCH'):export(mp,rp,out)
            self.assertEqual(out.read_text(),'preserve')

    def test_export_rejects_hash_consistent_malformed_shapes(self):
        model=json.loads((HERE/'evidence/policy-mlp-model.json').read_text())
        report=json.loads((HERE/'evidence/policy-mlp-evaluation.json').read_text())
        model['head']['scale'][0]=0
        report['modelSha256']=hashlib.sha256(json.dumps(model,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
        with tempfile.TemporaryDirectory() as name:
            directory=Path(name);mp=directory/'model.json';rp=directory/'report.json'
            mp.write_text(json.dumps(model));rp.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,'READOUT_SHAPE'):export(mp,rp,directory/'bad.ts')
            self.assertFalse((directory/'bad.ts').exists())


@unittest.skipIf(np is None,'optional NumPy learning environment not installed')
class LearningTests(unittest.TestCase):
    def test_whole_episode_splits_are_disjoint_including_new_test_after_failed_ridge(self):
        sets=[set(x) for x in (TRAIN_SEEDS,VALIDATION_SEEDS,TEST_SEEDS,FINAL_TEST_SEEDS)]
        for i,a in enumerate(sets):
            for b in sets[i+1:]:self.assertFalse(a&b)
        self.assertTrue(np.array_equal(episodes([123])[0][0],episodes([123])[0][0]))
        self.assertFalse(np.array_equal(episodes([123])[0][0],episodes([124])[0][0]))

    def test_recurrent_features_reset_at_episode_boundary(self):
        graph=json.loads((HERE/'evidence/descending-128.json').read_text())
        model=reservoir(graph,11,'connectome')
        data=episodes([1001,1002]);combined,_,_=features(data,model);isolated,_,_=features(data[1:],model)
        self.assertTrue(np.array_equal(combined[80:],isolated))
        self.assertTrue(np.isfinite(combined).all());self.assertLessEqual(abs(combined[:,11:]).max(),1)

    def test_actual_optimizer_learns_separable_synthetic_fixture(self):
        rng=np.random.default_rng(99)
        # Eight one-hot symbols, noise and an unrelated feature; not recorded neurons.
        y=np.tile(np.arange(8),32);x=np.eye(8)[y]+rng.normal(0,.03,(len(y),8))
        head,epoch,_=fit_head(x,y,x.copy(),y.copy(),11)
        independent=np.eye(8)[y]+rng.normal(0,.03,(len(y),8))
        self.assertGreater(np.mean(np.argmax(scores(independent,head),axis=1)==y),.95)
        self.assertGreater(epoch,0)
        self.assertTrue(np.isfinite(scores(independent,head)).all())


if __name__=='__main__':unittest.main()
