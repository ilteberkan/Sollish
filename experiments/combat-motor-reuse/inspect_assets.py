"""Bounded anonymous inspection of the official shared URL; no authentication."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

COMMIT = "2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69"
SHARED = "https://1sfu-my.sharepoint.com/:u:/g/personal/xbpeng_sfu_ca/EclKq9pwdOBAl-17SogfMW0Bved4sodZBQ_5eZCiz9O--w?e=bqXBaa"
LIMIT = 65_536


def inspect() -> dict:
    observations = []
    for label, url in [("official-url", SHARED), ("official-download", SHARED + "&download=1")]:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Sollish-Motor-Evaluation/1.0"})
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read(LIMIT)
                host = urllib.parse.urlsplit(response.url).hostname
                row = {"variant": label, "httpStatus": response.status,
                       "finalHost": host, "contentType": response.headers.get("Content-Type"),
                       "bytesRead": len(body), "prefixSha256": hashlib.sha256(body).hexdigest(),
                       "loginRedirect": host == "login.microsoftonline.com"}
        except urllib.error.HTTPError as error:
            body = error.read(LIMIT)
            row = {"variant": label, "httpStatus": error.code,
                   "bytesRead": len(body), "prefixSha256": hashlib.sha256(body).hexdigest(),
                   "loginRedirect": False}
        observations.append(row)
    # Bodies, cookies, query redirects and generated session identifiers are
    # intentionally never persisted. These observations cannot imply a download.
    result = {"schema": "sollish-motor-asset-access-v1",
              "atUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "upstreamCommit": COMMIT, "sourceUrl": SHARED,
              "observations": observations, "modelBytesAcquired": 0,
              "motionBytesAcquired": 0, "credentialsUsed": False,
              "maxResponseBytesPerRequest": LIMIT,
              "status": "BLOCKED" if all(r["httpStatus"] in (401, 403)
                                         or r["loginRedirect"] for r in observations)
                        else "UNRESOLVED_DO_NOT_LOAD"}
    out = Path(__file__).parent / "evidence/asset-access.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2))
