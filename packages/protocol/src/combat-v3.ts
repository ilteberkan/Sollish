/** Contact-based research simulation. V2 remains frozen in combat.ts.
 * Positions and recorded targets are integer mm. No wager/identity/profit enters a controller.
 * Learned readout and anatomy provenance are documented separately; this is not a functional fly brain.
 */
import type { CombatAction, FighterId } from './combat';
import { chooseCombatAction, createPolicyState, CONNECTOME_POLICY_INFO } from './connectome-policy';
export const COMBAT_V3_VERSION = 'ringside-contact-3-f8cd1d1f' as const;
export const COMBAT_V3_DURATION_MS = 45_000;
export const CONTACT_TICK_MS = 50;
export type Point3 = {x:number;y:number;z:number};
export type Limb = 'leftHand'|'rightHand'|'leftFoot'|'rightFoot';
export type ContactPose = Record<Limb|'leftElbow'|'rightElbow'|'leftKnee'|'rightKnee'|'head'|'chest',Point3>;
export type ContactFighter = {id:FighterId;x:number;z:number;yawMilliRad:number;health:number;stamina:number;action:CombatAction;actionAt:number;until:number;phase:'idle'|'windup'|'active'|'recovery';hits:number;knockdowns:number;pose:ContactPose};
export type ContactFrame = {tick:number;kor:ContactFighter;ayaz:ContactFighter;referee:{x:number;z:number;yawMilliRad:number}};
export type ContactEvent = {tick:number;type:'strike'|'hit'|'block'|'dodge'|'miss'|'knockdown'|'recovery'|'finish';actor:FighterId;target:FighterId;technique:CombatAction;damage:number;impact?:Point3;bodyPart?:'head'|'torso'|'guard'|'leg';limb?:Limb};
export type ContactInitial = {health:{kor:number;ayaz:number};stamina:{kor:number;ayaz:number}};
export type ContactReplay = {version:typeof COMBAT_V3_VERSION;policy:string;seed:string;frames:ContactFrame[];events:ContactEvent[];winner:FighterId|'draw';firstHit:FighterId|'simultaneous'|'none';knockdown:'yes'|'no';finish:'stoppage'|'decision'};
export const CONTACT_INITIAL:ContactInitial={health:{kor:1000,ayaz:1000},stamina:{kor:1000,ayaz:1000}};
export const CONTACT_BODY_RADIUS=320;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const point=(x:number,y:number,z:number):Point3=>({x:Math.round(x),y:Math.round(y),z:Math.round(z)});
const mix=(a:Point3,b:Point3,t:number)=>point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
const dist=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const specs={jab:{wind:5,active:3,end:13,damage:20,cost:90,limb:'leftHand',height:1670},cross:{wind:8,active:3,end:19,damage:29,cost:130,limb:'rightHand',height:1650},hook:{wind:9,active:4,end:22,damage:33,cost:145,limb:'rightHand',height:1660},kick:{wind:12,active:4,end:28,damage:38,cost:185,limb:'rightFoot',height:1100}} as const;
type Attack=keyof typeof specs;
const attacking=(a:CombatAction):a is Attack=>Object.hasOwn(specs,a);
type Agent=ContactFighter&{rng:()=>number;memory:Float64Array;landed:boolean;aim:Point3;stoppedAt:number;impact:Point3|null;lastStrike:number;high:number;low:number;damage:number};
function rng(seed:string,side:number){let a=(parseInt(seed.slice(side*16,side*16+8),16)^parseInt(seed.slice(side*16+8,side*16+16),16))>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return(t^t>>>14)>>>0;};}
function local(a:{x:number;z:number;yawMilliRad:number},x:number,y:number,z:number){const angle=a.yawMilliRad/1000,c=Math.cos(angle),s=Math.sin(angle);return point(a.x+x*c+z*s,y,a.z-x*s+z*c);}
export function contactGuardPose(a:{x:number;z:number;yawMilliRad:number}):ContactPose{return{head:local(a,0,1670,0),chest:local(a,0,1310,0),leftHand:local(a,-180,1460,300),rightHand:local(a,180,1460,300),leftFoot:local(a,-200,75,120),rightFoot:local(a,200,75,-180),leftElbow:local(a,-400,1200,70),rightElbow:local(a,400,1200,70),leftKnee:local(a,-240,530,200),rightKnee:local(a,240,530,100)};}
function reachableFeet(a:Agent,p:ContactPose):ContactPose {
 // Release a stance anchor before its leg stretches; measured 1.05-scale rig hips.
 for(const [limb,x,y,z] of [['leftFoot',-97,919,-44],['rightFoot',137,923,9]] as const){
  const hip=local(a,x,y,z),foot=p[limb],dx=foot.x-hip.x,dy=foot.y-hip.y,dz=foot.z-hip.z,d=Math.hypot(dx,dy,dz),reach=910;
  if(d>reach)p[limb]=point(hip.x+dx*reach/d,hip.y+dy*reach/d,hip.z+dz*reach/d);
 }
 return p;
}
function pose(a:Agent,tick:number):ContactPose{
 const p=contactGuardPose(a);
 if(a.action==='slip'){const offset=local(a,150,0,-60);p.head=point(p.head.x+offset.x-a.x,1630,p.head.z+offset.z-a.z);p.chest=point(p.chest.x+(offset.x-a.x)/2,1290,p.chest.z+(offset.z-a.z)/2);}
 if(['advance','circle','slip'].includes(a.action)){
  for(const [limb,phaseOffset] of [['leftFoot',0],['rightFoot',8]] as const){const phase=(tick+phaseOffset)%16;if(phase<8)p[limb]={...a.pose[limb]};else{p[limb]=mix(a.pose[limb],p[limb],.38);p[limb].y=75+Math.round(Math.sin((phase-8)/8*Math.PI)*85);}}
 }
 if(!attacking(a.action))return reachableFeet(a,p);const spec=specs[a.action],age=tick-a.actionAt;
 a.phase=age<spec.wind?'windup':age<spec.wind+spec.active?'active':'recovery';
 const guard=p[spec.limb],origin=spec.limb==='rightFoot'?local(a,160,900,0):spec.limb==='leftHand'?local(a,-198,1423,-138):local(a,232,1464,34);
 let target=a.aim;const max=spec.limb==='rightFoot'?895:600,dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z,n=Math.hypot(dx,dy,dz);if(n>max)target=point(origin.x+dx*max/n,origin.y+dy*max/n,origin.z+dz*max/n);
 let t=age<spec.wind?0:age<spec.wind+spec.active?(age-spec.wind+1)/spec.active:Math.max(0,1-(age-spec.wind-spec.active)/(spec.end-spec.wind-spec.active));
 if(a.impact){const recovery=clamp((tick-a.stoppedAt)/6,0,1);p[spec.limb]=mix(a.impact,guard,recovery);return reachableFeet(a,p);}
 // Distinct authored trajectories, shared by authoritative sweep and rendering IK.
 if(age<spec.wind){const w=Math.sin(age/spec.wind*Math.PI/2);p[spec.limb]=spec.limb==='rightFoot'?local(a,210,75+500*w,-180+180*w):local(a,spec.limb==='leftHand'?-190:200,1460,300-80*w);}
 else {p[spec.limb]=mix(guard,target,t);if(a.action==='hook'){const arc=Math.sin(t*Math.PI)*210;const side=local(a,arc,0,0);p[spec.limb].x+=side.x-a.x;p[spec.limb].z+=side.z-a.z;}if(a.action==='kick')p.rightKnee=local(a,330,850,430);}
 return reachableFeet(a,p);
}
/** Earliest time a swept spherical effector touches a spherical body part. Includes start overlap. */
export function sweepSphere(from:Point3,to:Point3,center:Point3,radius:number):number|null{
 const x=from.x-center.x,y=from.y-center.y,z=from.z-center.z,dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
 const c=x*x+y*y+z*z-radius*radius;if(c<=0)return 0;const a=dx*dx+dy*dy+dz*dz;if(!a)return null;const b=2*(x*dx+y*dy+z*dz),d=b*b-4*a*c;if(d<0)return null;const t=(-b-Math.sqrt(d))/(2*a);return t>=0&&t<=1?t:null;
}
function shapes(a:ContactFighter){const body=[{bodyPart:'head' as const,center:a.pose.head,radius:130},{bodyPart:'torso' as const,center:a.pose.chest,radius:225},{bodyPart:'torso' as const,center:point(a.x,1050,a.z),radius:205},{bodyPart:'leg' as const,center:local(a,-160,590,20),radius:120},{bodyPart:'leg' as const,center:local(a,160,590,-50),radius:120}];
 return a.action==='guard'?[{bodyPart:'guard' as const,center:a.pose.leftHand,radius:120},{bodyPart:'guard' as const,center:a.pose.rightHand,radius:120},...body]:body;
}
const view=(a:Agent):ContactFighter=>({id:a.id,x:a.x,z:a.z,yawMilliRad:a.yawMilliRad,health:a.health,stamina:a.stamina,action:a.action,actionAt:a.actionAt,until:a.until,phase:a.phase,hits:a.hits,knockdowns:a.knockdowns,pose:structuredClone(a.pose)});
/** Symmetric positional projection; no fighter/referee root capsules can overlap. */
export function separateBodies(a:{x:number;z:number},b:{x:number;z:number},minimum=CONTACT_BODY_RADIUS*2){const d=dist(a,b);if(d>=minimum)return;const dx=d?(b.x-a.x)/d:1,dz=d?(b.z-a.z)/d:0,shift=(minimum-d)/2+1;a.x=Math.round(a.x-dx*shift);a.z=Math.round(a.z-dz*shift);b.x=Math.round(b.x+dx*shift);b.z=Math.round(b.z+dz*shift);}
const bounded=(a:{x:number;z:number})=>{a.x=clamp(a.x,-3250,3250);a.z=clamp(a.z,-2200,2200);};
export function simulateContactCombat(seed:string,initial:ContactInitial=CONTACT_INITIAL):ContactReplay{
 if(CONNECTOME_POLICY_INFO.modelSha256!=='f8cd1d1feb8cf62f39eb2f1b11ebf95728deb8990f83594230d15709d2d9db9e')throw new Error('Frozen policy changed; retain old engine and create a new arena version');
 if(!/^[0-9a-f]{64}$/.test(seed))throw new TypeError('Expected a 32-byte lowercase seed');
 for(const key of ['health','stamina'] as const)for(const side of ['kor','ayaz'] as const)if(!Number.isInteger(initial[key][side])||initial[key][side]<1||initial[key][side]>1000)throw new TypeError('Invalid initial fighter state');
 const create=(id:FighterId,index:number):Agent=>{const base={id,x:index?1100:-1100,z:0,yawMilliRad:index?-1571:1571};return{...base,health:initial.health[id],stamina:initial.stamina[id],action:'advance',actionAt:0,until:8,phase:'idle',hits:0,knockdowns:0,pose:contactGuardPose(base),rng:rng(seed,index),memory:createPolicyState(),landed:false,aim:point(0,0,0),stoppedAt:0,impact:null,lastStrike:0,high:0,low:0,damage:0};};
 const agents=[create('kor',0),create('ayaz',1)],frames:ContactFrame[]=[],events:ContactEvent[]=[];
 let referee={x:0,z:-1750,yawMilliRad:0},stopped=false,winner:ContactReplay['winner']='draw';
 const event=(tick:number,type:ContactEvent['type'],a:Agent,b:Agent,damage=0,extra:Partial<ContactEvent>={})=>events.push({tick,type,actor:a.id,target:b.id,technique:a.action,damage,...extra});
 for(let tick=0;tick<=COMBAT_V3_DURATION_MS/CONTACT_TICK_MS;tick++){
  if(!stopped){
   const observations=agents.map(view);
   for(let i=0;i<2;i++){
    const a=agents[i],b=observations[1-i];a.stamina=Math.min(1000,a.stamina+(attacking(a.action)?2:8));
    if(tick<a.until)continue;
    const d=dist(a,b),bearing=Math.atan2(b.x-a.x,b.z-a.z),delta=Math.atan2(Math.sin(bearing-a.yawMilliRad/1000),Math.cos(bearing-a.yawMilliRad/1000)),visible=Math.abs(delta)<=Math.PI/3;
    const otherAttack=visible&&attacking(b.action)?specs[b.action]:null;
    const inputs=[clamp(d/2000-1,-1,1),a.stamina/500-1,a.health/500-1,otherAttack&&tick-b.actionAt<otherAttack.wind?1:-1,visible&&b.phase==='recovery'?1:-1,Math.abs(a.x)>2700||Math.abs(a.z)>1700?1:-1,clamp(delta/(Math.PI/3),-1,1),a.high?1:-1,a.low?1:-1,clamp((tick-a.lastStrike)/40-1,-1,1)];
    let next:CombatAction=chooseCombatAction(inputs,a.memory);
    // Physical feasibility and bounded engagement are explicit rules, not hidden profit controls.
    if(d>860)next='advance';else if(a.stamina<210)next='guard';else if(tick-a.lastStrike>42)next=(a.rng()%3===0?'kick':'jab');
    else if(next==='advance'&&d<740)next='circle';
    if(attacking(next)&&a.stamina<specs[next].cost)next='guard';
    a.action=next;a.actionAt=tick;a.until=tick+(attacking(next)?specs[next].end:6+a.rng()%5);a.phase=attacking(next)?'windup':'idle';a.landed=false;a.impact=null;
    a.yawMilliRad=Math.round(bearing*1000);
    if(attacking(next)){a.stamina-=specs[next].cost;a.aim=point(b.x,specs[next].height,b.z);a.lastStrike=tick;event(tick,'strike',a,agents[1-i]);}
   }
   const before=agents.map(view);
   for(let i=0;i<2;i++){
    const a=agents[i],b=before[1-i],d=dist(a,b)||1,dx=(b.x-a.x)/d,dz=(b.z-a.z)/d;
    if(!attacking(a.action))a.yawMilliRad=Math.round(Math.atan2(dx,dz)*1000);
    if(a.action==='advance'&&d>690){a.x+=Math.round(dx*39);a.z+=Math.round(dz*39);}
    if(a.action==='circle'||a.action==='slip'){const side=a.actionAt%2?1:-1,speed=a.action==='slip'?20:12;a.x-=Math.round(dz*speed*side);a.z+=Math.round(dx*speed*side);}
    if(attacking(a.action)&&tick-a.actionAt<specs[a.action].wind&&d>690){a.x+=Math.round(dx*19);a.z+=Math.round(dz*19);}
    bounded(a);
   }
   for(let pass=0;pass<3;pass++){separateBodies(agents[0],agents[1]);agents.forEach(bounded);}
   agents.forEach(a=>{a.pose=pose(a,tick);});
   const damage=[0,0];
   for(let i=0;i<2;i++){
    const a=agents[i],b=agents[1-i];if(!attacking(a.action)||a.landed)continue;const spec=specs[a.action],age=tick-a.actionAt;if(age<spec.wind||age>=spec.wind+spec.active)continue;
    const from=before[i].pose[spec.limb],to=a.pose[spec.limb],candidates=shapes(b).map(s=>({...s,t:sweepSphere(from,to,s.center,s.radius+(spec.limb==='rightFoot'?100:85))})).filter(s=>s.t!==null).sort((x,y)=>x.t!-y.t!);
    const hit=candidates[0];if(hit){a.landed=true;a.stoppedAt=tick;a.impact=mix(from,to,hit.t!);a.pose[spec.limb]=a.impact;
     const blocked=hit.bodyPart==='guard',amount=blocked?Math.floor(spec.damage/6):Math.floor(spec.damage*(hit.bodyPart==='head'?1:hit.bodyPart==='leg'?.55:.78));damage[1-i]+=amount;a.damage+=amount;if(!blocked)a.hits++;
     b.high=hit.bodyPart==='head'?1:0;b.low=hit.bodyPart==='leg'||spec.limb==='rightFoot'?1:0;
     event(tick,blocked?'block':'hit',a,b,amount,{impact:{...a.impact},bodyPart:hit.bodyPart,limb:spec.limb});
    }else if(age===spec.wind+spec.active-1){a.landed=true;event(tick,b.action==='slip'?'dodge':'miss',a,b);}
   }
   agents.forEach((a,i)=>{a.health=Math.max(0,a.health-damage[i]);if(!a.health){a.knockdowns++;event(tick,'knockdown',agents[1-i],a);a.action='down';a.actionAt=tick;a.phase='idle';a.until=901;}});
   if(agents.some(a=>!a.health)){stopped=true;winner=agents[0].health===agents[1].health?'draw':agents[0].health>agents[1].health?'kor':'ayaz';event(tick,'finish',agents[winner==='ayaz'?1:0],agents[winner==='ayaz'?0:1]);}
   const mid={x:(agents[0].x+agents[1].x)/2,z:(agents[0].z+agents[1].z)/2};
   const target={x:clamp(mid.x,-2400,2400),z:clamp(mid.z-1550,-2100,2100)};const d=dist(referee,target)||1;referee.x+=Math.round((target.x-referee.x)/d*Math.min(28,d));referee.z+=Math.round((target.z-referee.z)/d*Math.min(28,d));
   // Referee yields; fighter trajectories are unaffected by the official's presentation.
   for(let pass=0;pass<4;pass++)for(const a of agents){const d=dist(referee,a),min=740;if(d<min){const dx=d?(referee.x-a.x)/d:0,dz=d?(referee.z-a.z)/d:-1;referee.x=Math.round(a.x+dx*(min+2));referee.z=Math.round(a.z+dz*(min+2));}bounded(referee);}
   referee.yawMilliRad=Math.round(Math.atan2(mid.x-referee.x,mid.z-referee.z)*1000);
  }
  if(stopped)for(const a of agents)if(a.action!=='down'){a.pose=pose(a,tick);if(tick>=a.until){a.action='guard';a.phase='idle';a.pose=contactGuardPose(a);}}
  frames.push({tick,kor:view(agents[0]),ayaz:view(agents[1]),referee:{...referee}});
 }
 if(!stopped)winner=agents[0].damage===agents[1].damage?'draw':agents[0].damage>agents[1].damage?'kor':'ayaz';
 const first=events.find(e=>e.type==='hit');return{version:COMBAT_V3_VERSION,policy:CONNECTOME_POLICY_INFO.version,seed,frames,events,winner,firstHit:!first?'none':events.some(e=>e.type==='hit'&&e.tick===first.tick&&e.actor!==first.actor)?'simultaneous':first.actor,knockdown:stopped?'yes':'no',finish:stopped?'stoppage':'decision'};
}
export function contactFrameAt(replay:ContactReplay,elapsedMs:number){return replay.frames[Math.floor(clamp(Number.isFinite(elapsedMs)?elapsedMs:0,0,COMBAT_V3_DURATION_MS)/CONTACT_TICK_MS)];}
