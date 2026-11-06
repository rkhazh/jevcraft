'use strict';
const {Vec3}=require('vec3'),{goals}=require('mineflayer-pathfinder');
const RANGE=16,ARRIVAL=1.5,HAZARD=/^(water|lava|fire|soul_fire|magma_block|campfire|soul_campfire|cactus|sweet_berry_bush|powder_snow|nether_portal|end_portal)$/;
const point=p=>p&&Object.keys(p).sort().join()==='x,y,z'&&[p.x,p.y,p.z].every(Number.isFinite);
const dimension=bot=>String(bot.game?.dimension||'').replace(/^minecraft:/,'');
function safeStanding(bot,p){
 if(!point(p)||Math.abs(p.y-Math.round(p.y))>.01)return false;
 const at=(x,y,z)=>bot.blockAt(new Vec3(Math.floor(x),Math.floor(y),Math.floor(z)));
 for(const dx of [-.3,.3])for(const dz of [-.3,.3]){
  const floor=at(p.x+dx,p.y-.01,p.z+dz),feet=at(p.x+dx,p.y+.01,p.z+dz),head=at(p.x+dx,p.y+1.79,p.z+dz);
  if(!floor||floor.boundingBox!=='block'||floor.shapes?.some(s=>s[4]<1)||!feet||!head||[floor,feet,head].some(b=>HAZARD.test(b.name))||feet.shapes?.length||head.shapes?.length)return false;
 }
 return true;
}
function canMove(bot,target,{enabled=false,anchor=bot.entity?.position,nativeCapabilities=bot?._personaNativeCapabilities===true}={}){
 if(nativeCapabilities)return enabled&&!!anchor&&point(target)&&Math.abs(target.x)<=29999984&&Math.abs(target.z)<=29999984&&target.y>=(bot.game?.minY??-64)&&target.y<(bot.game?.minY??-64)+(bot.game?.height??384);
 return enabled&&bot.game?.gameMode==='survival'&&dimension(bot)==='overworld'&&!!anchor&&point(target)&&Math.hypot(target.x-anchor.x,target.y-anchor.y,target.z-anchor.z)<=RANGE&&safeStanding(bot,target);
}
function standingAffordances(bot,{enabled=false,now=()=>Date.now()/1000,nativeCapabilities=bot?._personaNativeCapabilities===true}={}){
 const result={observed_at:now(),standing_points:[],route_prevalidated:false,search_radius:8,vertical_range:2,block_read_limit:384,block_reads:0};
 const anchor=bot.entity?.position;
 if(!enabled||!anchor||![anchor.x,anchor.y,anchor.z].every(Number.isFinite)||!nativeCapabilities&&(bot.game?.gameMode!=='survival'||dimension(bot)!=='overworld'))return result;
 const cache=new Map(),probe=Object.create(bot),found=[],seen=new Set();
 probe.blockAt=p=>{const key=`${p.x},${p.y},${p.z}`;if(cache.has(key))return cache.get(key);if(result.block_reads>=result.block_read_limit)return null;result.block_reads++;const block=bot.blockAt(p);cache.set(key,block);return block;};
 // Spatial coverage only, independent of goals, structures, materials or a route.
 for(const radius of [2,4,8])for(let sector=0;sector<8;sector++){
  const angle=sector*Math.PI/4,x=Math.floor(anchor.x+Math.cos(angle)*radius)+.5,z=Math.floor(anchor.z+Math.sin(angle)*radius)+.5;
  if(Math.hypot(x-anchor.x,z-anchor.z)>8)continue;
  for(const dy of [0,1,-1,2,-2]){
   const target={x,y:Math.floor(anchor.y)+dy,z},key=JSON.stringify(target);
   if(Math.abs(target.y-anchor.y)>2||Math.hypot(x-anchor.x,target.y-anchor.y,z-anchor.z)<=ARRIVAL||seen.has(key))continue;
   if(canMove(probe,target,{enabled:true,anchor,nativeCapabilities})&&(!nativeCapabilities||safeStanding(probe,target))){found.push(target);seen.add(key);break;}
  }
 }
 const count=Math.min(12,found.length);
 for(let i=0;i<count;i++)result.standing_points.push(found[Math.floor(i*found.length/count)]);
 return result;
}
function blocked(message){return Object.assign(new Error(message),{name:'Blocked',personaMoveTerminal:true});}
// Native movement owns transit collision/step geometry. A node may be a slab,
// stair or doorway rather than a place suitable for stopping and inspecting.
function transitAllowed(bot,node,anchor){
 const p={x:node.x+.5,y:node.y,z:node.z+.5};
 if(!point(p)||Math.hypot(p.x-anchor.x,p.y-anchor.y,p.z-anchor.z)>RANGE)return false;
 return transitSafe(bot,node);
}
function transitSafe(bot,node){
 if(node.toBreak?.length||node.toPlace?.some(effect=>!effect.useOne))return false;
 return [-1,0,1].every(dy=>{const block=bot.blockAt(new Vec3(node.x,node.y+dy,node.z));return !!block&&!HAZARD.test(block.name);});
}
function localMovements(bot,policy){
 const original=bot.pathfinder.movements;
 const movement=Object.assign(Object.create(Object.getPrototypeOf(original)),original,{canDig:false,allow1by1towers:false,scafoldingBlocks:[],allowParkour:false,allowFreeMotion:false,canOpenDoors:false,maxDropDown:1,allowSprinting:false});
 movement.blocksToAvoid=new Set(original.blocksToAvoid||[]);for(const block of Object.values(bot.registry?.blocksByName||{}))if(HAZARD.test(block.name))movement.blocksToAvoid.add(block.id);
 const neighbors=movement.getNeighbors;movement.getNeighbors=function(node){return neighbors.call(this,node).filter(n=>transitAllowed(bot,n,policy.anchor));};
 return movement;
}
async function moveStep(bot,task,goal,save,{timeoutMs=15000,checkIntervalMs=100}={}){
 task.check();const policy=goal.personaMovePolicy,p=goal.target;
 if(goal.nativeCapabilities===true||bot._personaNativeCapabilities===true){
  const normalize=require('./memory').dimension;
  if(!canMove(bot,p,{enabled:true,nativeCapabilities:true})||policy?.dimension&&normalize(bot.game?.dimension)!==normalize(policy.dimension))throw blocked('Native move target is invalid or its dimension changed');
  const distance=()=>Math.hypot(bot.entity.position.x-p.x,bot.entity.position.y-p.y,bot.entity.position.z-p.z);
  if(distance()<=ARRIVAL)return true;
  const startedDimension=dimension(bot),checked=Object.create(task);
  checked.check=()=>{task.check();if(dimension(bot)!==startedDimension)throw blocked('Move dimension changed');};
  goal.step={action:'move',target:{...p},position:{...p}};save();
  await require('./skills').navigate(bot,checked,new goals.GoalNear(p.x,p.y,p.z,1),{});
  checked.check();if(distance()>ARRIVAL)throw blocked('Native move ended without verified arrival');
  return true;
 }
 if(!policy||dimension(bot)!==policy.dimension||!canMove(bot,p,{enabled:true,anchor:policy.anchor}))throw blocked('Local move target is no longer safe, loaded or within its admitted bounds');
 const distance=()=>Math.hypot(bot.entity.position.x-p.x,bot.entity.position.y-p.y,bot.entity.position.z-p.z);
 if(distance()<=ARRIVAL)return true;
 const original=bot.pathfinder?.movements;if(!original)throw blocked('Local movement unavailable');
 const movement=localMovements(bot,policy);
 goal.step={action:'move',target:{...p},position:{...p}};save();
 let timer,checks;bot.pathfinder.setMovements(movement);
 const destination=new goals.GoalNear(p.x,p.y,p.z,1),doorUse=require('./doors').guardNavigationDoors(bot,task,destination);
 try{
  const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(blocked('Local move timed out without verified arrival')),timeoutMs);checks=setInterval(()=>{try{task.check();if(doorUse.error)throw doorUse.error;if(dimension(bot)!==policy.dimension||!safeStanding(bot,p))throw blocked('Local move destination changed');}catch(err){reject(err)}},checkIntervalMs)});
  await Promise.race([bot.pathfinder.goto(destination),guard]);task.check();if(doorUse.error)throw doorUse.error;
  if(distance()>ARRIVAL)throw blocked('Local move ended without verified arrival');return true;
 }catch(err){if(['Cancelled','NeedsAir','NeedsSafety','Stalled'].includes(err.name))throw err;throw blocked(String(err.message||'Local route unavailable').slice(0,240));}
 finally{clearTimeout(timer);clearInterval(checks);doorUse.restore();bot.pathfinder.setGoal(null);bot.clearControlStates();bot.pathfinder.setMovements(original);}
}
module.exports={RANGE,ARRIVAL,safeStanding,canMove,moveStep,standingAffordances,localMovements,transitAllowed,transitSafe};
