"""Validate saved numeric evidence without changing thresholds or running physics."""
import hashlib
import json
import math
from pathlib import Path

EVIDENCE = Path(__file__).parent / "evidence"


def numbers(value, count, bound=1000):
    if not isinstance(value, list) or len(value) != count or any(
        type(v) not in (int, float) or not math.isfinite(v) or abs(v) > bound for v in value
    ):
        raise ValueError("INVALID_NUMERIC_VECTOR")


def validate(trace):
    if trace.get("schema") != "sollish-learned-motor-trace-v1" or trace.get("upAxis") != "Y" or trace.get("quaternion") != "xyzw" or trace.get("units") != "metres":
        raise ValueError("INVALID_TRACE_CONVENTIONS")
    bones = trace["bones"]
    if len(bones) != 16 or bones[0] != {"name": "base", "parent": -1}:
        raise ValueError("INVALID_HIERARCHY")
    for i, bone in enumerate(bones[1:], 1):
        if type(bone["parent"]) is not int or not 0 <= bone["parent"] < i:
            raise ValueError("INVALID_HIERARCHY")
    def pose(rows):
        if len(rows) != len(bones):
            raise ValueError("POSE_LENGTH")
        for row in rows:
            numbers(row["p"], 3)
            numbers(row["q"], 4, 1.001)
            if abs(sum(x*x for x in row["q"])-1) > 1e-4:
                raise ValueError("NONUNIT_QUATERNION")
    pose(trace["referenceRestPose"])
    if trace["referenceRestPose"][0] != {"p": [0,0,0], "q": [0,0,0,1]}:
        raise ValueError("REST_BASE_NOT_IDENTITY")
    if len(trace["geometry"]) != 15:
        raise ValueError("GEOMETRY_COUNT")
    for shape in trace["geometry"]:
        if type(shape["bone"]) is not int or not 0 <= shape["bone"] < len(bones):
            raise ValueError("INVALID_GEOMETRY_BONE")
        lengths = {"sphere": 1, "capsule": 2, "box": 3}
        if shape["type"] not in lengths:
            raise ValueError("UNKNOWN_GEOMETRY")
        numbers(shape["dimensions"], lengths[shape["type"]], 2)
        if min(shape["dimensions"]) <= 0:
            raise ValueError("INVALID_DIMENSIONS")
        numbers(shape["p"], 3, 2)
        numbers(shape["q"], 4, 1.001)
        if abs(sum(x*x for x in shape["q"])-1) > 1e-4:
            raise ValueError("NONUNIT_GEOMETRY_QUATERNION")
    metrics = trace["metrics"]
    for key in ("p95JointPositionErrorMeters", "maxContactPenetrationMeters", "freeBaseMass"):
        value = metrics[key]
        if type(value) not in (int,float) or not math.isfinite(value) or value < 0:
            raise ValueError("NONFINITE_METRIC")
    speed = metrics["p95SupportedFootHorizontalSpeedMps"]
    if speed is not None and (type(speed) not in (int,float) or not math.isfinite(speed) or speed < 0):
        raise ValueError("NONFINITE_METRIC")
    seconds = metrics["seconds"]
    if not 1 <= seconds <= 10 or len(trace["frames"]) != seconds*60:
        raise ValueError("FRAME_BUDGET")
    previous = -1
    for frame in trace["frames"]:
        if not previous < frame["t"] <= seconds:
            raise ValueError("NONMONOTONIC_TIME")
        previous = frame["t"]
        pose(frame["bones"]); pose(frame["reference"])
        for contact in frame["contacts"]:
            numbers(contact["p"], 3)
            if type(contact["force"]) not in (int,float) or not math.isfinite(contact["force"]) or contact["force"] < 0:
                raise ValueError("INVALID_CONTACT")
    expected = {
        "trackingP95Under5cm": metrics["p95JointPositionErrorMeters"] < .05,
        "penetrationUnder5mm": metrics["maxContactPenetrationMeters"] < .005,
        "supportedFootSpeedP95Under10cmps": metrics["p95SupportedFootHorizontalSpeedMps"] is not None and metrics["p95SupportedFootHorizontalSpeedMps"] < .1,
    }
    balanced = metrics["firstDisallowedGroundContactSeconds"] is None
    if metrics["qualityGates"] != expected or metrics["independentBalanceObserved"] != balanced or metrics["qualityReady"] != (all(expected.values()) and balanced):
        raise ValueError("GATE_MISREPRESENTATION")
    if metrics["rootAssistApplied"] is not False or metrics["freeBaseMass"] <= 0:
        raise ValueError("FREE_BASE_METADATA")
    return {"frames": len(trace["frames"]), "bones": len(bones), "colliders": len(trace["geometry"]),
            "qualityReady": metrics["qualityReady"], "independentBalanceObserved": balanced}


def main():
    results = []
    for row in json.loads((EVIDENCE / "render-traces.json").read_text()):
        path = EVIDENCE / row["path"]
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != row["sha256"]:
            raise ValueError("RENDER_TRACE_HASH_MISMATCH")
        trace = json.loads(raw)
        original = EVIDENCE / row["path"].replace("-render-trace.json", "-trace.json")
        prior = json.loads(original.read_bytes())
        if hashlib.sha256(original.read_bytes()).hexdigest() != trace["rawTraceSha256"] or trace["frames"] != prior["frames"] or trace["metrics"] != prior["metrics"]:
            raise ValueError("PHYSICS_EVIDENCE_MODIFIED")
        results.append({"path": row["path"], "sha256": row["sha256"], **validate(trace)})
    report = {"status": "PASS", "scope": "Numeric schema, hashes, immutable physics frames and honest fixed gate labels; not quality-gate PASS", "traces": results}
    (EVIDENCE / "validation.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
