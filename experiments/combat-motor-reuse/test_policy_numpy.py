import unittest
import numpy as np
from policy_numpy import Actor


def tensors():
    result = {}
    for name, shape in [("0/dense", (197,1024)), ("1/dense", (1024,512)), ("dense", (512,36))]:
        result["agent/main/actor/"+name+"/kernel"] = np.zeros(shape,dtype=np.float32)
        result["agent/main/actor/"+name+"/bias"] = np.zeros(shape[1],dtype=np.float32)
    for name,size in [("s",197),("a",36)]:
        result[f"agent/resource/{name}_norm/mean"] = np.zeros(size,dtype=np.float32)
        result[f"agent/resource/{name}_norm/std"] = np.ones(size,dtype=np.float32)
    return result


class PolicyTests(unittest.TestCase):
    def test_affine_normalization_relu_and_output_unscale(self):
        t=tensors();p="agent/main/actor/"
        for name,k,b in [("0/dense",2,-1),("1/dense",3,-2),("dense",5,-2)]:
            t[p+name+"/kernel"][0,0]=k;t[p+name+"/bias"][0]=b
        t["agent/resource/s_norm/mean"][0]=2;t["agent/resource/s_norm/std"][0]=2
        t["agent/resource/a_norm/mean"][0]=7;t["agent/resource/a_norm/std"][0]=2
        actor=Actor(t);s=np.zeros(197,dtype=np.float32);s[0]=4
        self.assertEqual(actor(s)[0],13)  # 1 -> ReLU(2*1-1) -> 3*1-2 -> 5*1-2 -> 2*3+7
        s[0]=-4
        self.assertEqual(actor(s)[0],3)

    def test_rejects_wrong_observation_dimensions_and_nan(self):
        actor=Actor(tensors())
        for x in [np.zeros(227),np.full(197,np.nan),np.zeros((1,197))]:
            with self.assertRaises(ValueError): actor(x)

    def test_rejects_incompatible_or_nonfinite_checkpoint(self):
        for key,value in [("agent/resource/s_norm/std",np.zeros(197,dtype=np.float32)),
                          ("agent/main/actor/dense/kernel",np.zeros((512,28),dtype=np.float32)),
                          ("agent/main/actor/dense/bias",np.full(36,np.inf,dtype=np.float32))]:
            t=tensors();t[key]=value
            with self.assertRaises(ValueError):Actor(t)


if __name__ == "__main__":unittest.main()
