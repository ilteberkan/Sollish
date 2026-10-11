"""Fetch one permitted CMU motion, never crawl the database or repackage it for resale."""
from pathlib import Path
import hashlib,io,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[2]
COMMIT='3bc9c75c481ac6e622f3c378369b293d8de9be45'
BASE='https://raw.githubusercontent.com/Shriinivas/cmubvh/'+COMMIT+'/'
FILES=[('READMEFIRST.txt','8e6fe2e640b3728ef2e43e722cb5ae9cdf0010028c0517c4226ed165f9037930'),('Sequence-010-014/13/Data/13_18.zip','19432ab29c93d48a51830b5469a9bb647784bfa59fac3e50884ac325c1b51679')]
def fetch():
    dest=ROOT/'.tooling/combat-physics/sources';dest.mkdir(parents=True,exist_ok=True)
    for path,digest in FILES:
        data=urllib.request.urlopen(BASE+path,timeout=25).read(3_000_001)
        if len(data)>3_000_000 or hashlib.sha256(data).hexdigest()!=digest:raise ValueError('source checksum/size')
        (dest/Path(path).name).write_bytes(data)
        if path.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if archive.namelist()!=['13_18.bvh'] or archive.getinfo('13_18.bvh').file_size>3_000_000:raise ValueError('archive members/size')
                bvh=archive.read('13_18.bvh')
                if hashlib.sha256(bvh).hexdigest()!='24efe49cc97292cbce871bec7ed3a2413118da63d435b9ad46a57e7eb81eafbb':raise ValueError('bvh checksum')
                (dest/'13_18.bvh').write_bytes(bvh)
if __name__=='__main__':fetch()
