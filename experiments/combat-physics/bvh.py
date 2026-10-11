"""Bounded BVH reader; channel order is preserved, first T-pose remains separate."""
from dataclasses import dataclass
import re
import numpy as np

@dataclass
class Bone:
    name: str
    parent: int
    offset: np.ndarray
    channels: list
    start: int

def parse(text):
    if len(text) > 8_000_000: raise ValueError('BVH size limit')
    header, motion = text.split('MOTION', 1)
    tokens = iter(re.findall(r'[{}]|[^\s{}]+', header))
    bones=[]; channels=0
    if next(tokens) != 'HIERARCHY': raise ValueError('hierarchy')
    def joint(parent, kind):
        nonlocal channels
        name = next(tokens) if kind!='End' else bones[parent].name+'_End'
        if kind=='End' and next(tokens)!='Site': raise ValueError('end')
        if len(bones)>=100 or any(b.name==name for b in bones): raise ValueError('bone bound/name')
        i=len(bones); b=Bone(name,parent,np.zeros(3),[],channels);bones.append(b)
        if next(tokens)!='{':raise ValueError('brace')
        while True:
            t=next(tokens)
            if t=='}':break
            if t=='OFFSET':b.offset=np.array([float(next(tokens)) for _ in range(3)])
            elif t=='CHANNELS':
                n=int(next(tokens));b.channels=[next(tokens) for _ in range(n)];b.start=channels;channels+=n
                if n not in [3,6] or any(c not in ['Xposition','Yposition','Zposition','Xrotation','Yrotation','Zrotation'] for c in b.channels):raise ValueError('channels')
            elif t in ['JOINT','End']:joint(i,t)
            else:raise ValueError('token')
    if next(tokens)!='ROOT':raise ValueError('root')
    joint(-1,'ROOT')
    lines=motion.strip().splitlines();count=int(lines[0].split(':')[1]);dt=float(lines[1].split(':')[1])
    if not 1<=count<=20000 or not 0<dt<=.1:raise ValueError('frames/time')
    values=np.array([[float(v) for v in l.split()] for l in lines[2:]],dtype=np.float64)
    if values.shape!=(count,channels) or not np.isfinite(values).all():raise ValueError('frame shape/finite')
    return bones,values,dt

def multiply(a,b):
    w,x,y,z=a;v,i,j,k=b
    return np.array([w*v-x*i-y*j-z*k,w*i+x*v+y*k-z*j,w*j-x*k+y*v+z*i,w*k+x*j-y*i+z*v])

def local_pose(bones, frame, scale):
    positions=[];quats=[]
    for b in bones:
        p=b.offset*scale;q=np.array([1.,0,0,0])
        for channel,value in zip(b.channels,frame[b.start:b.start+len(b.channels)]):
            a='XYZ'.index(channel[0])
            if channel.endswith('position'):p[a]+=value*scale
            else:
                r=np.deg2rad(value)/2;v=np.zeros(4);v[0]=np.cos(r);v[a+1]=np.sin(r);q=multiply(q,v)
        positions.append(p);quats.append(q)
    return np.array(positions),np.array(quats)

def rotate(q,v):
    return multiply(multiply(q,np.r_[0,v]),q*np.array([1,-1,-1,-1]))[1:]

def forward(bones,positions,quats):
    p=[];q=[]
    for i,b in enumerate(bones):
        if b.parent<0:p.append(positions[i]);q.append(quats[i])
        else:p.append(p[b.parent]+rotate(q[b.parent],positions[i]));q.append(multiply(q[b.parent],quats[i]))
    return np.array(p),np.array(q)
