'use strict';
const {Vec3}=require('vec3'),{randomUUID,createHash}=require('node:crypto');
const {exact}=require('./persona-admission');
const {dependenciesMatch}=require('./persona-actions');
function validQuery(q,here,nativeCapabilities=false){
 const point=p=>exact(p,['x','y','z'])&&[p.x,p.y,p.z].every(Number.isFinite)&&!!here&&(nativeCapabilities||Math.hypot(p.x-here.x,p.y-here.y,p.z-here.z)<=16)&&Math.abs(p.x)<=29999984&&Math.abs(p.z)<=29999984&&p.y>=-64&&p.y<=319;
 if(q?.kind==='view')return exact(q,['kind','target'])&&(q.target===null||point(q.target));
 return q?.kind==='cells'&&exact(q,['kind','cells'])&&Array.isArray(q.cells)&&q.cells.length>0&&(nativeCapabilities||q.cells.length<=64)&&q.cells.every(p=>point(p)&&[p.x,p.y,p.z].every(Number.isInteger))&&new Set(q.cells.map(p=>JSON.stringify(p))).size===q.cells.length;
}
function createInspector({bot,getSessionId,capture,look,canView=()=>false,now=()=>Date.now()/1000}){
 const history=new Map();let busy=false,worldRevision=0;bot.on?.('blockUpdate',(_old,b)=>{const p=b?.position,h=bot.entity?.position;if(p&&h&&Math.hypot(p.x-h.x,p.y-h.y,p.z-h.z)<=16)worldRevision++;});
 const states=q=>q.kind==='cells'?q.cells.map(p=>{const b=bot.blockAt(new Vec3(p.x,p.y,p.z));return {position:p,state:b?{name:b.name,state_id:b.stateId,properties:b.getProperties?.()||{}}:null};}):null;
 function signature(q){return JSON.stringify({q,pose:{position:bot.entity?.position,yaw:bot.entity?.yaw,pitch:bot.entity?.pitch},dimension:bot.game?.dimension,world_revision:q.kind==='view'?worldRevision:null,cells:states(q)});}
 function canInspect(q){if(!validQuery(q,bot.entity?.position,bot._personaNativeCapabilities)||busy||q.kind==='view'&&!canView())return false;return bot._personaNativeCapabilities||(history.get(signature(q))?.repeats||0)<2;}
 async function inspect(q,session){
  if(session!==getSessionId()||!canInspect(q))throw Error('inspection_unavailable');busy=true;
  try{
   let frame=null,cells=null;
   if(q.kind==='view'){if(q.target!==null)await look(q.target);if(session!==getSessionId()||!canView())throw Error('stale_inspection');frame=await capture();}
   else cells=states(q);
   if(session!==getSessionId())throw Error('stale_session');
   const key=signature(q),hash=createHash('sha256').update(JSON.stringify(cells??{image:frame?.image_base64??frame?.image??frame?.png_base64,position:frame?.position,yaw:frame?.yaw,pitch:frame?.pitch})).digest('hex');
   const previous=history.get(key),information_added=previous?.hash!==hash;
   history.set(key,{hash,repeats:information_added?0:(previous?.repeats||0)+1});if(history.size>128)history.delete(history.keys().next().value);
   return {status:'complete',session_id:session,evidence_id:randomUUID(),observed_at:now(),query:q,cells,frame,information_added,signature:key};
  }finally{busy=false;}
 }
 return {inspect,canInspect};
}
function inspectionCandidates(snapshot){
 const points=snapshot.movement_capabilities?.local_move?.standing_points||[];
 return points.map(target=>({kind:'start_goal',args:{spec:{kind:'move',target}},expected:'Approach an observed standing point; route unverified'}));
}
module.exports={createInspector,validQuery,inspectionCandidates};
