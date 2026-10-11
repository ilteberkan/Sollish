"""Retrieve only the small pinned upstream files; never fetch external weights."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import urllib.request

HERE = Path(__file__).parent
DEST = HERE.parents[1] / ".tooling/combat-motor-reuse/source"
PREFIX = "https://raw.githubusercontent.com/xbpeng/MimicKit/2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69/"


def prepare():
    rows = json.loads((HERE / "evidence/source-provenance.json").read_text())
    for row in rows:
        path = PurePosixPath(row["path"])
        if path.is_absolute() or ".." in path.parts or row["url"] != PREFIX + str(path):
            raise ValueError("SOURCE_PATH")
        with urllib.request.urlopen(row["url"], timeout=20) as response:
            raw = response.read(200_001)
        if len(raw) != row["bytes"] or len(raw) > 200_000:
            raise ValueError("SOURCE_LENGTH")
        if hashlib.sha256(raw).hexdigest() != row["sha256"]:
            raise ValueError("SOURCE_SHA256")
        target = DEST / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    (DEST.parent / "source-provenance.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    prepare()
