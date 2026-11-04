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
function canMove(bot,target,{enabled=false,anchor=bot.entity?.position}={}){
 return enabled&&bot.game?.gameMode==='survival'&&dimension(bot)==='overworld'&&!!anchor&&point(target)&&Math.hypot(target.x-anchor.x,target.y-anchor.y,target.z-anchor.z)<=RANGE&&safeStanding(bot,target);
}
function blocked(message){return Object.assign(new Error(message),{name:'Blocked',personaMoveTerminal:true});}
async function moveStep(bot,task,goal,save,{timeoutMs=15000,checkIntervalMs=100}={}){
 task.check();const policy=goal.personaMovePolicy,p=goal.target;
 if(!policy||dimension(bot)!==policy.dimension||!canMove(bot,p,{enabled:true,anchor:policy.anchor}))throw blocked('Local move target is no longer safe, loaded or within its admitted bounds');
 const distance=()=>Math.hypot(bot.entity.position.x-p.x,bot.entity.position.y-p.y,bot.entity.position.z-p.z);
 if(distance()<=ARRIVAL)return true;
 const original=bot.pathfinder?.movements;if(!original)throw blocked('Local movement unavailable');
 const movement=Object.assign(Object.create(Object.getPrototypeOf(original)),original,{canDig:false,allow1by1towers:false,scafoldingBlocks:[],allowParkour:false,allowFreeMotion:false,canOpenDoors:false,maxDropDown:1,allowSprinting:false});
 movement.blocksToAvoid=new Set(original.blocksToAvoid||[]);for(const block of Object.values(bot.registry?.blocksByName||{}))if(HAZARD.test(block.name))movement.blocksToAvoid.add(block.id);
 const neighbors=movement.getNeighbors;movement.getNeighbors=function(node){return neighbors.call(this,node).filter(n=>!(n.toBreak?.length||n.toPlace?.length)&&canMove(bot,{x:n.x+.5,y:n.y,z:n.z+.5},{enabled:true,anchor:policy.anchor}));};
 goal.step={action:'move',target:{...p},position:{...p}};save();
 let timer,checks;bot.pathfinder.setMovements(movement);
 try{
  const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(blocked('Local move timed out without verified arrival')),timeoutMs);checks=setInterval(()=>{try{task.check();if(dimension(bot)!==policy.dimension||!safeStanding(bot,p))throw blocked('Local move destination changed');}catch(err){reject(err)}},checkIntervalMs)});
  await Promise.race([bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,1)),guard]);task.check();
  if(distance()>ARRIVAL)throw blocked('Local move ended without verified arrival');return true;
 }catch(err){if(['Cancelled','NeedsAir','NeedsSafety','Stalled'].includes(err.name))throw err;throw blocked(String(err.message||'Local route unavailable').slice(0,240));}
 finally{clearTimeout(timer);clearInterval(checks);bot.pathfinder.setGoal(null);bot.clearControlStates();bot.pathfinder.setMovements(original);}
}
module.exports={RANGE,ARRIVAL,safeStanding,canMove,moveStep};
