/** Explicit research geometry, not a mutation of the frozen live engine. Units: mm. */
const point=(x,y,z)=>({x:Math.round(x),y:Math.round(y),z:Math.round(z)});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
function sphere(from,to,center,radius){const m=sub(from,center),v=sub(to,from),c=dot(m,m)-radius*radius;if(c<=0)return 0;const a=dot(v,v);if(a===0)return null;const b=dot(m,v),d=b*b-a*c;if(d<0)return null;const t=(-b-Math.sqrt(d))/a;return t>=0&&t<=1?t:null;}

/** First intersection of a moving point and a finite capsule, including initial overlap. */
export function sweepCapsule(from,to,a,b,radius){
  if(![from,to,a,b].every(p=>[p.x,p.y,p.z].every(Number.isFinite))||!Number.isFinite(radius)||radius<=0)throw new Error('INVALID_CAPSULE');
  const axis=sub(b,a),v=sub(to,from),m=sub(from,a),dd=dot(axis,axis);if(dd<1e-9)return sphere(from,to,a,radius);
  const md=dot(m,axis),nd=dot(v,axis),u=Math.max(0,Math.min(1,md/dd)),closest={x:a.x+u*axis.x,y:a.y+u*axis.y,z:a.z+u*axis.z};
  if(dot(sub(from,closest),sub(from,closest))<=radius*radius)return 0;
  const hits=[sphere(from,to,a,radius),sphere(from,to,b,radius)].filter(t=>t!==null);
  const qa=dd*dot(v,v)-nd*nd,qb=dd*dot(m,v)-md*nd,qc=dd*(dot(m,m)-radius*radius)-md*md;
  if(qa>1e-9){const d=qb*qb-qa*qc;if(d>=0)for(const t of [(-qb-Math.sqrt(d))/qa,(-qb+Math.sqrt(d))/qa]){const along=md+t*nd;if(t>=0&&t<=1&&along>=0&&along<=dd)hits.push(t);}}
  return hits.length?Math.min(...hits):null;
}

/** Two-link solution: measured upper arm265, forearm257 plus glove offset90. */
export function researchElbow(shoulder,glove,pole){
  const delta=sub(glove,shoulder),distance=Math.sqrt(dot(delta,delta)),l1=265,l2=347;
  if(distance<Math.abs(l1-l2)||distance>l1+l2)throw new Error('GUARD_OUTSIDE_ARM_REACH');
  const axis={x:delta.x/distance,y:delta.y/distance,z:delta.z/distance},p=sub(pole,shoulder),parallel=dot(p,axis);
  let perp={x:p.x-parallel*axis.x,y:p.y-parallel*axis.y,z:p.z-parallel*axis.z},length=Math.sqrt(dot(perp,perp));
  if(length<1e-9){const fallback=Math.abs(axis.y)<.9?{x:0,y:1,z:0}:{x:1,y:0,z:0},projection=dot(fallback,axis);perp={x:fallback.x-projection*axis.x,y:fallback.y-projection*axis.y,z:fallback.z-projection*axis.z};length=Math.sqrt(dot(perp,perp));}
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  return point(shoulder.x+axis.x*along+perp.x*height/length,shoulder.y+axis.y*along+perp.y*height/length,shoulder.z+axis.z*along+perp.z*height/length);
}

export function researchGuardShapes(fighter){
  const hands=fighter.action==='jab'?['right']:['cross','hook'].includes(fighter.action)?['left']:['guard','kick'].includes(fighter.action)?['left','right']:[];
  return hands.flatMap(side=>{
    const hand=fighter.pose[`${side}Hand`],elbow=fighter.pose[`${side}Elbow`],delta=sub(hand,elbow),length=Math.sqrt(dot(delta,delta));
    const wrist={x:hand.x-delta.x*90/length,y:hand.y-delta.y*90/length,z:hand.z-delta.z*90/length};
    return [{bodyPart:'guard',center:hand,radius:120},{bodyPart:'guard',capsule:[elbow,wrist],radius:45}];
  });
}
export function researchSweep(from,to,shape,effectorRadius){return shape.capsule?sweepCapsule(from,to,shape.capsule[0],shape.capsule[1],shape.radius+effectorRadius):sphere(from,to,shape.center,shape.radius+effectorRadius);}
