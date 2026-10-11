"""Query real Bullet colliders and zero-joint rest frames, without a rollout.

getCollisionShapeData reports transforms relative to the inertial frame. Convert
these to link-local coordinates because trace frames contain world link origins.
The referenceRestPose is a freshly loaded URDF at base identity and joint zero;
it is not the first mocap frame and cannot be treated as a different skin's bind.
"""
import hashlib
import json
from pathlib import Path

from export_checkpoint import EVIDENCE

ANATOMY = {
    "base": "floating-base coordinate; no collider", "root": "pelvis",
    "chest": "torso", "neck": "head proxy",
    "right_hip": "right thigh", "right_knee": "right shin",
    "right_ankle": "right foot", "right_shoulder": "right upper arm",
    "right_elbow": "right forearm", "right_wrist": "right hand",
    "left_hip": "left thigh", "left_knee": "left shin",
    "left_ankle": "left foot", "left_shoulder": "left upper arm",
    "left_elbow": "left forearm", "left_wrist": "left hand",
}


def query_geometry():
    import pybullet as p
    import pybullet_data
    path = Path(pybullet_data.getDataPath()) / "humanoid/humanoid.urdf"
    cid = p.connect(p.DIRECT)
    try:
        body = p.loadURDF(str(path), basePosition=[0, 0, 0],
                          baseOrientation=[0, 0, 0, 1], globalScaling=.25,
                          useFixedBase=True, flags=p.URDF_MAINTAIN_LINK_ORDER,
                          physicsClientId=cid)
        count = p.getNumJoints(body, physicsClientId=cid)
        bones = [{"name": "base", "parent": -1}]
        rest = [{"p": [0, 0, 0], "q": [0, 0, 0, 1]}]
        geometry = []
        for j in range(count):
            info = p.getJointInfo(body, j, physicsClientId=cid)
            bones.append({"name": info[12].decode(), "parent": info[16] + 1})
            state = p.getJointStateMultiDof(body, j, physicsClientId=cid)
            expected = (0., 0., 0., 1.) if info[2] == p.JOINT_SPHERICAL else ((0.,) if info[2] == p.JOINT_REVOLUTE else ())
            if tuple(state[0]) != expected:
                raise ValueError("REST_JOINT_NOT_DEFAULT")
            frame = p.getLinkState(body, j, computeForwardKinematics=True, physicsClientId=cid)
            rest.append({"p": list(frame[4]), "q": list(frame[5])})
        for j in range(-1, count):
            dynamics = p.getDynamicsInfo(body, j, physicsClientId=cid)
            for shape in p.getCollisionShapeData(body, j, physicsClientId=cid):
                if shape[2] == p.GEOM_SPHERE:
                    kind, dimensions = "sphere", [shape[3][0]]
                elif shape[2] == p.GEOM_BOX:
                    kind, dimensions = "box", list(shape[3])  # full extents
                elif shape[2] == p.GEOM_CAPSULE:
                    kind, dimensions = "capsule", [shape[3][1], shape[3][0]]
                else:
                    raise ValueError("UNSUPPORTED_COLLIDER")
                pos, rot = p.multiplyTransforms(dynamics[3], dynamics[4], shape[5], shape[6])
                geometry.append({"bone": j+1, "type": kind, "dimensions": dimensions,
                                 "p": list(pos), "q": list(rot)})
        return {"schema": "sollish-bullet-geometry-v1", "upAxis": "Y", "units": "metres",
                "quaternion": "xyzw", "globalScaling": .25,
                "urdfSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "source": "PyBullet3.2.7 humanoid/humanoid.urdf; queried loaded collision shapes",
                "capsuleAxis": "Z", "capsuleDimensions": "radius,cylinderLength",
                "boxDimensions": "fullSizesXYZ", "shapeSpace": "link-local",
                "restPoseMeaning": "URDF default zero joints, base at origin/identity; not an animation or skin bind",
                "bones": bones, "anatomy": [ANATOMY[b["name"]] for b in bones],
                "referenceRestPose": rest, "geometry": geometry}
    finally:
        p.disconnect(cid)


def enrich(path, data):
    original = path.read_bytes()
    trace = json.loads(original)
    if trace["bones"] != data["bones"]:
        raise ValueError("TRACE_HIERARCHY_MISMATCH")
    trace.update({key: data[key] for key in ("geometry", "referenceRestPose", "anatomy")})
    trace["geometryMetadata"] = {key: data[key] for key in (
        "urdfSha256", "source", "capsuleAxis", "capsuleDimensions", "boxDimensions", "shapeSpace", "restPoseMeaning")}
    trace["referencePoseMeaning"] = "Initial animated mocap reference, not rest or skin bind pose"
    trace["rawTraceSha256"] = hashlib.sha256(original).hexdigest()
    out = path.with_name(path.name.replace("-trace.json", "-render-trace.json"))
    raw = (json.dumps(trace, separators=(",", ":"), allow_nan=False)+"\n").encode()
    out.write_bytes(raw)
    return {"path": out.name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "rawTraceSha256": trace["rawTraceSha256"]}


if __name__ == "__main__":
    data = query_geometry()
    (EVIDENCE / "humanoid-geometry.json").write_text(json.dumps(data, indent=2)+"\n")
    outputs = [enrich(path, data) for path in sorted(EVIDENCE.glob("*iterations-trace.json"))]
    (EVIDENCE / "render-traces.json").write_text(json.dumps(outputs, indent=2)+"\n")
    print(json.dumps(outputs, indent=2))
