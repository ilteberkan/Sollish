"""Local assisted articulated-body experiment. No live game or outcome integration."""
from pathlib import Path
import json,hashlib,time,platform,xml.etree.ElementTree as E
import numpy as np
import mujoco
from bvh import parse,local_pose,forward,multiply
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'.tooling/combat-physics/sources/13_18.bvh'
EXPECTED='24efe49cc97292cbce871bec7ed3a2413118da63d435b9ad46a57e7eb81eafbb'
DT=1/600; SCALE=.056444; SECONDS=8
HINGES={'LeftLeg':([.93969262,.34202014,0],155),'RightLeg':([.93969262,-.34202014,0],155),'LeftForeArm':([0,-.8660254,.5],155),'RightForeArm':([0,.8660254,-.5],155)}
ALIGN=np.array([2**-.5,2**-.5,0,0]) # BVH Y-up to MuJoCo Z-up.

def vec(v):return ' '.join(f'{x:.9g}' for x in v)
def setup():
    raw=SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=EXPECTED:raise ValueError('source digest')
    bones,frames,frame_dt=parse(raw.decode());poses=[local_pose(bones,f,SCALE) for f in frames[:int(SECONDS/frame_dt)+3]]
    p0,q0=forward(bones,*poses[1]);foot=[i for i,b in enumerate(bones) if b.name in ['LeftToeBase','RightToeBase','LeftFoot','RightFoot']]
    origin=poses[1][0][0].copy();origin[1]=min(p0[i][1] for i in foot)-.055
    doc=E.Element('mujoco',model='CMU13_18_assisted_physics_probe');E.SubElement(doc,'compiler',angle='degree',autolimits='true')
    E.SubElement(doc,'option',timestep=str(DT),gravity='0 0 -9.81',integrator='implicitfast',iterations='80',tolerance='1e-9')
    defaults=E.SubElement(doc,'default');E.SubElement(defaults,'joint',damping='2',armature='.015');E.SubElement(defaults,'geom',friction='1.1 .02 .002',solref='.008 1',solimp='.95 .99 .001',condim='3')
    world=E.SubElement(doc,'worldbody');E.SubElement(world,'light',pos='2 -2 4');E.SubElement(world,'geom',name='floor',type='plane',size='4 4 .1',rgba='.1 .13 .17 1')
    # A freely sliding passive padded target, positioned after actual reference FK.
    # It cannot cause damage or choose a winner; only physical contact is measured.
    hand_idx=[i for i,b in enumerate(bones) if b.name in ['LeftHand','RightHand']]
    sample_world=[forward(bones,*p)[0] for p in poses[1:]]
    hand_samples=np.array([[p[i] for i in hand_idx] for p in sample_world]).reshape(-1,3)
    target=hand_samples[np.argmax(hand_samples[:,2])]-origin
    bag=E.SubElement(world,'body',name='bag',pos=vec([target[0],-target[2]+.10,1.35]));E.SubElement(bag,'joint',name='bag_slide',type='slide',axis='0 1 0',damping='20',limited='true',range='-.5 .5');E.SubElement(bag,'geom',name='bag_geom',type='capsule',size='.18 .36',mass='18',rgba='.14 .5 .53 1')
    elements=[]
    for i,b in enumerate(bones):
        parent=world if b.parent<0 else elements[b.parent]
        e=E.SubElement(parent,'body',name=b.name,pos=vec(b.offset*SCALE),quat=vec(poses[0][1][i]) if i else '1 0 0 0');elements.append(e)
        if i==0:E.SubElement(e,'freejoint',name='root')
        elif b.name in HINGES:E.SubElement(e,'joint',name=b.name+'_joint',type='hinge',axis=vec(HINGES[b.name][0]),limited='true',range='0 '+str(HINGES[b.name][1]))
        elif b.channels:E.SubElement(e,'joint',name=b.name+'_joint',type='ball',limited='true',range='0 175')
        children=[c for c in bones if c.parent==i and np.linalg.norm(c.offset)>.01]
        important=b.name in ['Hips','Spine','Spine1','Neck1','Head','LeftArm','RightArm','LeftForeArm','RightForeArm','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot','LeftHand','RightHand']
        radius=.07 if 'Leg' in b.name else .052
        if b.name in ['Spine','Spine1','Hips']:radius=.065
        if b.name=='Neck1':radius=.035
        if b.name=='Head':radius=.08
        if 'Hand' in b.name:radius=.085
        if 'Foot' in b.name:radius=.055
        if important:
            end=children[0].offset*SCALE if children else np.array([0,.10,0])
            E.SubElement(e,'geom',name=b.name+'_geom',type='capsule',fromto=vec(np.r_[np.zeros(3),end]),size=str(radius),density='650',rgba='.83 .34 .20 1',contype='1',conaffinity='3')
        else:E.SubElement(e,'inertial',pos='0 0 0',mass='.015',diaginertia='.0001 .0001 .0001')
    # Ignore direct physical neighbours, including intervening zero-length helper bones.
    contacts=E.SubElement(doc,'contact')
    physical={i for i,e in enumerate(elements) if e.find('geom') is not None}
    for i in physical:
        parent=bones[i].parent
        while parent>=0 and parent not in physical:parent=bones[parent].parent
        if parent>=0:E.SubElement(contacts,'exclude',body1=bones[i].name,body2=bones[parent].name)
    # Axial proxy capsules overlap by construction; treat the torso/neck/head as one collision group.
    existing={tuple(sorted([e.attrib['body1'],e.attrib['body2']])) for e in contacts}
    axial=['Hips','Spine','Spine1','Neck1','Head']
    for i,a in enumerate(axial):
        for b in axial[i+1:]:
            if tuple(sorted([a,b])) not in existing:E.SubElement(contacts,'exclude',body1=a,body2=b)
    for g in world.findall('geom'):g.set('contype','2');g.set('conaffinity','1')
    bag.find('geom').set('contype','2');bag.find('geom').set('conaffinity','1')
    xml=E.tostring(doc,encoding='unicode');m=mujoco.MjModel.from_xml_string(xml)
    def target_pose(frame):
        p,q=poses[min(len(poses)-1,frame)];v=m.qpos0.copy();root=m.joint('root').qposadr[0];v[root:root+3]=[p[0][0]-origin[0],-(p[0][2]-origin[2]),p[0][1]-origin[1]];v[root+3:root+7]=multiply(ALIGN,q[0])
        for i,b in enumerate(bones):
            if i and b.channels:
                a=m.joint(b.name+'_joint').qposadr[0];delta=multiply(poses[0][1][i]*np.array([1,-1,-1,-1]),q[i])
                if b.name in HINGES:
                    axis,limit=HINGES[b.name];v[a]=np.clip(2*np.arctan2(np.dot(delta[1:],axis),delta[0]),0,np.deg2rad(limit))
                else:v[a:a+4]=delta
        return v
    return m,bones,frames,poses,target_pose,frame_dt,xml,origin

def run(write=True):
    m,bones,frames,poses,target,frame_dt,xml,origin=setup();d=mujoco.MjData(m);ref=mujoco.MjData(m);d.qpos[:]=target(1);mujoco.mj_forward(m,d)
    root_dof=m.joint('root').dofadr[0]; error=np.zeros(m.nv);torque=np.zeros(m.nv); mass=np.zeros((m.nv,m.nv))
    trace=[];max_pen=0;contact_steps=0;target_contacts=0;max_torque=0;track=[];foot_speed=[];supported_speed=[];self_contacts=0;last_foot=None;states=[];st=time.perf_counter()
    body_ids=[m.body(b.name).id for b in bones]
    def snapshot(data):
        out=[]
        for bi in body_ids:
            p=data.xpos[bi];q=data.xquat[bi];world_q=multiply(np.array([ALIGN[0],-ALIGN[1],0,0]),q)
            out.append({'p':[round(float(p[0]),5),round(float(p[2]),5),round(float(-p[1]),5)],'q':[round(float(v),6) for v in [*world_q[1:],world_q[0]]]})
        return out
    for step in range(round(SECONDS/DT)):
        at=min(int(step*DT/frame_dt)+1,len(poses)-1);ref.qpos[:]=target(at);mujoco.mj_forward(m,ref)
        mujoco.mj_differentiatePos(m,error,1,d.qpos,ref.qpos)
        # Bounded torque motors + explicit six-DOF support harness at the pelvis.
        mujoco.mj_fullM(m,d,mass)
        torque[:]=mass@(100*error-20*d.qvel)+d.qfrc_bias-d.qfrc_passive
        torque[:]=np.clip(torque,-95,95)
        unbounded=mass@(100*error-20*d.qvel)+d.qfrc_bias-d.qfrc_passive
        torque[root_dof:root_dof+3]=np.clip(unbounded[root_dof:root_dof+3],-1500,1500)
        torque[root_dof+3:root_dof+6]=np.clip(unbounded[root_dof+3:root_dof+6],-250,250)
        torque[0]=0 # Passive bag slide has no motor.
        d.qfrc_applied[:]=torque;max_torque=max(max_torque,float(np.max(np.abs(torque[root_dof+6:]))));mujoco.mj_step(m,d)
        if not np.isfinite(d.qpos).all() or np.max(np.abs(d.qvel))>500:raise RuntimeError('unstable physics')
        contacts=[];supported=set()
        for ci in range(d.ncon):
            c=d.contact[ci];max_pen=max(max_pen,max(0,-float(c.dist)));force=np.zeros(6);mujoco.mj_contactForce(m,d,ci,force)
            g1=m.geom(c.geom1).name;g2=m.geom(c.geom2).name
            if force[0]>1:
                contact_steps+=1
                if 'floor' in [g1,g2]:
                    for name in ['LeftFoot','RightFoot']:
                        if name+'_geom' in [g1,g2]:supported.add(name)
                elif 'bag_geom' not in [g1,g2]:self_contacts+=1
            if 'bag_geom' in [g1,g2] and force[0]>1:target_contacts+=1
            if step%10==0:contacts.append({'p':[round(float(c.pos[0]),5),round(float(c.pos[2]),5),round(float(-c.pos[1]),5)],'force':round(float(force[0]),3),'geom1':g1,'geom2':g2})
        track.append(float(np.mean(np.linalg.norm(d.xpos[body_ids]-ref.xpos[body_ids],axis=1))))
        foot=np.array([d.xpos[m.body(n).id] for n in ['LeftFoot','RightFoot']]);
        if last_foot is not None:
            for i,f in enumerate(foot):
                if f[2]<.13:foot_speed.append(float(np.linalg.norm((f-last_foot[i])[:2])/DT))
                if ['LeftFoot','RightFoot'][i] in supported:supported_speed.append(float(np.linalg.norm((f-last_foot[i])[:2])/DT))
        last_foot=foot.copy();states.append(d.qpos.copy())
        if step%10==0:trace.append({'t':round((step+1)*DT,6),'bones':snapshot(d),'reference':snapshot(ref),'contacts':contacts,'bag':[round(float(d.xpos[m.body('bag').id][a]*sign),5) for a,sign in [(0,1),(2,1),(1,-1)]]})
    seconds=time.perf_counter()-st
    metrics={'steps':len(states),'physicsDt':DT,'runtimeSeconds':seconds,'simulatedSeconds':SECONDS,'meanJointPositionErrorMeters':float(np.mean(track)),'p95JointPositionErrorMeters':float(np.percentile(track,95)),'maxContactPenetrationMeters':max_pen,'groundAndBagContactsOver1N':contact_steps,'bagContactsOver1N':target_contacts,'p95LowFootHorizontalSpeedMps':float(np.percentile(foot_speed,95)) if foot_speed else None,'p95SupportedFootHorizontalSpeedMps':float(np.percentile(supported_speed,95)) if supported_speed else None,'selfContactSamplesOver1N':self_contacts,'maxNonRootGeneralizedTorqueNm':max_torque,'finite':True,'stateSha256':hashlib.sha256(np.array(states,dtype='<f8').tobytes()).hexdigest()}
    metrics['qualityGates']={'trackingP95Under5cm':metrics['p95JointPositionErrorMeters']<.05,'penetrationUnder5mm':max_pen<.005,'supportedFootSpeedP95Under10cmps':bool(supported_speed) and metrics['p95SupportedFootHorizontalSpeedMps']<.1}
    metrics['qualityReady']=all(metrics['qualityGates'].values())
    ref.qpos[:]=target(0);mujoco.mj_forward(m,ref)
    report={'schema':'sollish-physics-trace-v1','engine':'MuJoCo '+mujoco.__version__,'sourceSha256':EXPECTED,'dt':1/60,'duration':SECONDS,'bones':[{'name':b.name,'parent':b.parent,'offset':list(b.offset*SCALE)}for b in bones],'referencePose':snapshot(ref),'frames':trace,'metrics':metrics,'limitations':['Assisted tracking: pelvis has a bounded six-DOF support wrench; not an independently balanced controller.','Knees/elbows are single-axis 0..155 degree hinges calibrated to capture rest axes; other ball swings 175 degrees. Engineering bounds, not validated biomechanics.','Nonadjacent self collision, floor and passive bag collisions active; direct physical neighbours and overlapping axial proxy group excluded.','One CMU boxing capture; noisy fingers/toes preserved as non-colliding branches.','No opponent, scoring, learned policy, wager, payout or production authority.']}
    if not write:return report
    out=Path(__file__).parent/'evidence';out.mkdir(exist_ok=True);(out/'trace.json').write_text(json.dumps(report,separators=(',',':'))+'\n');(out/'metrics.json').write_text(json.dumps({'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'platform':platform.platform(),'engine':report['engine'],'sourceSha256':EXPECTED,'metrics':metrics,'limitations':report['limitations']},indent=2)+'\n');(out/'model.xml').write_text(xml);print(json.dumps(metrics,indent=2));return report
if __name__=='__main__':run()
