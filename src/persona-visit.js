'use strict';
const {createHash}=require('node:crypto'),{Vec3}=require('vec3');
const {dimension,position,visitPlace}=require('./memory'),{travelHazards,damagingTerrain}=require('./terrain');
const MAX_DISTANCE=96,ARRIVAL_DISTANCE=3,TIMEOUT_MS=60000;
const text=(s,n)=>String(s||'').replace(/[\p{Cc}\p{Cf}]/gu,' ').slice(0,n);
const stamp=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)&&n>=0?n/1000:null;};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function references(bot,{known={},principal}={}){
 const out=[],add=(id,label,p,dim,source,at)=>{p=position(p);if(!p||typeof dim!=='string'||!dim||id.length>128)return;out.push({id,label:text(label,240),position:p,dimension:dimension(dim),source,observed_at:stamp(at),access:'unverified'});};
 for(const e of bot.buildRegistry?.all()||[]){
  const entrance=position(e.entrance||e.blueprint?.entrance),lo=position(e.bounds?.min),hi=position(e.bounds?.max);
  const p=entrance||(lo&&hi&&{x:(lo.x+hi.x)/2,y:(lo.y+hi.y)/2,z:(lo.z+hi.z)/2});
  if(e.id)add(`project:${e.id}`,e.name||e.label||'Registered project',p,e.dimension,entrance?'project_recorded_entrance':'project_reference_point',e.updatedAt||e.createdAt);
 }
 if(principal)for(const e of bot.companionMemory?.context(principal)?.places||[])if(e.id)add(`place:${e.id}`,e.label,e.position,e.dimension,'saved_place',e.at);
 for(const e of require('./exploration').foundEntries(known)){
  const p=position(e.position);if(!p||!e.dimension)continue;
  const key=JSON.stringify([e.kind,dimension(e.dimension),p.x,p.y,p.z]),id=createHash('sha256').update(key).digest('hex').slice(0,24);
  add(`landmark:${id}`,e.label,p,e.dimension,'observed_landmark',e.firstAt);
 }
 return out;
}
function capabilities(bot,options={}){
 const here=position(bot.entity?.position),dim=dimension(bot.game?.dimension),enabled=options.enabled===true;
 const destinations=enabled&&here?references(bot,options).filter(d=>d.dimension===dim&&distance(here,d.position)<=MAX_DISTANCE).sort((a,b)=>distance(here,a.position)-distance(here,b.position)||a.id.localeCompare(b.id)).slice(0,32):[];
 return {enabled,max_distance:MAX_DISTANCE,arrival_distance:ARRIVAL_DISTANCE,timeout_seconds:TIMEOUT_MS/1000,route_prevalidated:false,destinations};
}
// Resolution deliberately does not use the nearest/truncated advertisement:
// travel and new observations cannot evict an otherwise unchanged reference.
function resolveDestination(bot,id,options){return references(bot,options).find(d=>d.id===id)||null;}
function destinationMatches(a,b){return !!a&&!!b&&a.id===b.id&&a.source===b.source&&dimension(a.dimension)===dimension(b.dimension)&&['x','y','z'].every(k=>a.position?.[k]===b.position?.[k]);}
function blocked(message){return Object.assign(new Error(message),{name:'Blocked',personaVisitTerminal:true});}
function assertDestination(bot,goal,resolve){
 const frozen=goal?.personaVisitPolicy?.destination;
 if(!frozen||!destinationMatches(frozen,goal.destination)||!destinationMatches(frozen,resolve?.(frozen.id))||!bot.game?.dimension||dimension(bot.game.dimension)!==frozen.dimension)throw blocked('Visit destination changed or is no longer available.');
 return frozen;
}
// Verify the actual body and its contact surface, not an integer target cell.
// Mineflayer's onGround plus loaded collision shapes admits slabs and stair
// treads while rejecting unknown support, hazardous terrain and body overlap.
function safeFooting(bot){
 const p=position(bot.entity?.position);if(!p||bot.entity.onGround!==true)return false;
 const half=(bot.entity.width||.6)/2,height=bot.entity.height||1.8,eps=1e-4;
 let supported=require('./motion').centerContact(bot);
 for(let x=Math.floor(p.x-half+eps);x<=Math.floor(p.x+half-eps);x++)for(let z=Math.floor(p.z-half+eps);z<=Math.floor(p.z+half-eps);z++)for(let y=Math.floor(p.y-.025);y<=Math.floor(p.y+height-eps);y++){
  const b=bot.blockAt(new Vec3(x,y,z));if(!b||travelHazards.has(b.name)||damagingTerrain.has(b.name))return false;
  if([true,'true'].includes(b.getProperties?.().waterlogged)&&y+1>p.y+eps)return false;
  if(!Array.isArray(b.shapes))return false;
  for(const s of b.shapes){
   if(x+s[3]<=p.x-half+eps||x+s[0]>=p.x+half-eps||z+s[5]<=p.z-half+eps||z+s[2]>=p.z+half-eps)continue;
   if(y+s[4]>p.y+eps&&y+s[1]<p.y+height-eps)return false;
   if(Math.abs(y+s[4]-p.y)<=.025)supported=true;
  }
 }
 return supported&&!require('./motion').fallUnder(bot);
}
function verifyVisit(bot,goal,{resolve= id=>bot._personaVisitResolve?.(id,goal?.from)}={}){
 if(goal)delete goal.visitArrival;
 let target;try{target=assertDestination(bot,goal,resolve);}catch{return false;}
 const here=position(bot.entity?.position);if(!here)return false;
 const near=distance(here,target.position);
 goal.visitArrival={destination_id:target.id,position:{...target.position},dimension:target.dimension,arrival_position:here,distance:near,arrival_distance:ARRIVAL_DISTANCE};
 return near<=ARRIVAL_DISTANCE&&safeFooting(bot);
}
async function visitStep(bot,task,goal,save,{resolve=id=>bot._personaVisitResolve?.(id,goal.from),navigate=require('./skills').navigate,now=Date.now}={}){
 const deadline=Number(goal.personaVisitPolicy?.startedAt)+TIMEOUT_MS;
 const checked=Object.create(task);
 checked.check=()=>{task.check();if(!Number.isFinite(deadline)||now()>=deadline)throw blocked('Visit deadline elapsed.');assertDestination(bot,goal,resolve);};
 try{
  checked.check();
  // Await native cancellation/cleanup before releasing this controller. Its
  // watchdog and recovery wait both call the bounded task check.
  const arrived=await visitPlace(bot,checked,goal,save,{navigate:(b,t,g,options)=>navigate(b,t,g,{...options,onFoot:true,passing:false,navigationOnly:true,timeoutMs:Math.max(1,deadline-now())})});
  checked.check();
  if(!arrived||!verifyVisit(bot,goal,{resolve}))throw blocked('Visit ended without observed near-arrival on safe current footing.');
  save();return true;
 }catch(err){if(['NeedsSafety','NeedsAir','Cancelled','Preempted'].includes(err.name))throw err;err.personaVisitTerminal=true;throw err;}
 // Native navigation owns control cleanup and its protective edge crouch.
 // A rejected reference or unbegun walk has acquired no control ownership.
}
module.exports={capabilities,resolveDestination,destinationMatches,safeFooting,assertDestination,verifyVisit,visitStep,blocked,MAX_DISTANCE,ARRIVAL_DISTANCE,TIMEOUT_MS};
