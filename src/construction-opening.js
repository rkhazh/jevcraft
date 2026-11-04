'use strict';
const {Vec3}=require('vec3');
const {matchesBuildBlock,matchesOwnership}=require('./build-blocks');
const {blueprintFingerprint}=require('./restoration-permit');
const key=p=>`${p.x},${p.y},${p.z}`,vec=p=>new Vec3(p.x,p.y,p.z);
const directions=[[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]];
const air=b=>b&&['air','cave_air','void_air'].includes(b.name);
const cube=b=>b?.shapes?.length===1&&b.shapes[0].every((n,i)=>n===(i<3?0:1));
// Reversible full cubes only: no containers, paired/oriented pieces, falling
// blocks, fluids, fragile glass or block entities whose contents could be lost.
const simple=name=>/^(?:[a-z_]+_planks|cobblestone|stone|stone_bricks|bricks|dirt|andesite|diorite|granite|deepslate|cobbled_deepslate)$/.test(name||'');
function accessBlocked(message='I cannot reach the next part of the building with the available local access; the design and progress are saved'){
 return Object.assign(new Error(message),{name:'ConstructionAccessBlocked',personaBuildTerminal:true});
}
function sameProject(bot,goal){
 const entry=bot.buildRegistry?.find(goal.buildId);
 return entry&&entry.from===goal.from&&entry.dimension===String(bot.game?.dimension||'').replace(/^minecraft:/,'')&&
  blueprintFingerprint(entry.blueprint)===blueprintFingerprint(goal.blueprint)?entry:null;
}
function safeOpening(bot,goal,opening,expected){
 const entry=sameProject(bot,goal),p=vec(opening),block=bot.blockAt(p);
 if(!entry||bot.buildRegistry.editProtection(bot,entry).has(key(p))||opening.companion||Object.keys(opening.properties||{}).length||!simple(opening.material)||!cube(block)||!block.diggable||
  !matchesBuildBlock(block,opening)||!matchesOwnership(block,expected??entry.buildOwned?.[key(p)]))return false;
 // Removing a support must not drop attachments, release liquid or falling
 // blocks. Unknown neighboring geometry is not evidence that opening is safe.
 return directions.every(([x,y,z])=>{const b=bot.blockAt(p.offset(x,y,z));return air(b)||cube(b)&&simple(b.name);});
}
function openingCandidates(bot,goal,missing){
 if(!goal.personaGoalId||goal.buildAccess||!sameProject(bot,goal))return [];
 const planned=new Map(goal.blueprint.blocks.map(c=>[key(c),c])),seen=new Set(),out=[];
 for(const target of missing.slice(0,16)){
  if(target.companion||!simple(target.material)||Object.keys(target.properties||{}).length)continue;
  for(const [x,y,z]of directions){
   const opening=planned.get(key(vec(target).offset(x,y,z)));
   if(!opening||seen.has(key(opening))||!safeOpening(bot,goal,opening))continue;
   seen.add(key(opening));out.push({position:opening,operation:'dig',material:opening.material,accessTarget:target});
  }
 }
 return out.slice(0,16);
}
function checkpoint(bot,goal,save){
 // Normal goal saves are debounced and the registry is otherwise updated only
 // at terminal completion. Persist the opening obligation before any mutation.
 bot.buildRegistry.remember(goal,{dimension:bot.game.dimension,status:'unfinished'});save();
}
function startOpening(bot,goal,work,save){
 if(goal.buildAccess||!safeOpening(bot,goal,work.position))throw accessBlocked('The recorded access block changed before opening');
 goal.buildAccess={buildId:goal.buildId,blueprint:blueprintFingerprint(goal.blueprint),target:structuredClone(work.accessTarget),opening:structuredClone(work.position),
  expected:structuredClone(sameProject(bot,goal).buildOwned[key(work.position)]),phase:'opening'};
 checkpoint(bot,goal,save);
}
function validOpeningState(bot,goal){
 const a=goal.buildAccess;
 if(!a||a.buildId!==goal.buildId||a.blueprint!==blueprintFingerprint(goal.blueprint)||!sameProject(bot,goal)||!['opening','repairing','restoring'].includes(a.phase))return false;
 return [a.target,a.opening].every(c=>goal.blueprint.blocks.some(p=>key(p)===key(c)&&p.material===c.material&&JSON.stringify(p.properties||{})===JSON.stringify(c.properties||{})));
}
// One opening at a time. The original plan is never edited, and no normal
// construction candidate can refill the access before its target is repaired.
async function continueOpening(bot,task,goal,save,{choose,execute,acquire}){
 const a=goal.buildAccess;if(!a)return false;
 task.check();if(!validOpeningState(bot,goal))throw accessBlocked('The saved access repair no longer matches this building plan');
 const opening=bot.blockAt(vec(a.opening));
 if(!opening||!air(opening)&&!matchesBuildBlock(opening,a.opening))throw accessBlocked('The temporary access cell changed; its restoration remains saved');
 if(a.phase==='opening'&&air(opening)){a.phase='repairing';checkpoint(bot,goal,save);}
 if(a.phase==='repairing'&&matchesBuildBlock(bot.blockAt(vec(a.target)),a.target)){a.phase='restoring';checkpoint(bot,goal,save);}
 if(a.phase==='restoring'&&matchesBuildBlock(opening,a.opening)){
  delete goal.buildAccess;delete goal.buildBatch;checkpoint(bot,goal,save);
  if(a.failure)throw accessBlocked(a.failure);
  return true;
 }
 if(a.phase==='opening'&&!safeOpening(bot,goal,a.opening,a.expected))throw accessBlocked('The recorded access block is no longer safe to open');
 // A restart or survival interruption may have consumed the material. Keep
 // the closure reserved until it is restored, even while repairing the target.
 const needed={};for(const c of a.phase==='restoring'?[a.opening]:[a.target,a.opening])needed[c.material]=(needed[c.material]||0)+1;
 for(const [item,count]of Object.entries(needed))if(bot.game?.gameMode!=='creative'&&(bot.inventory.items().filter(i=>i.name===item).reduce((n,i)=>n+i.count,0)<count)){
  try{await acquire(item,count);}catch(error){task.check();if(['NeedsAir','NeedsSafety','Cancelled'].includes(error.name))throw error;throw accessBlocked('Materials for the saved local repair cannot currently be acquired');}
  return true;
 }
 const cell=a.phase==='repairing'?a.target:a.opening,operation=air(bot.blockAt(vec(cell)))?'place':'dig';
 let work=await choose([{position:cell,operation,material:cell.material,properties:cell.properties,accessOpening:a.phase==='opening'}]);
 if(!work){
  if(a.phase==='repairing'){a.failure='The local opening did not provide a reachable repair face; the design and progress are saved';a.phase='restoring';checkpoint(bot,goal,save);return true;}
  throw accessBlocked('The temporary access cannot be reached safely; its restoration remains saved');
 }
 try{await execute(work);}
 catch(error){
  task.check();if(['NeedsAir','NeedsSafety','Cancelled'].includes(error.name))throw error;
  if(a.phase==='restoring')throw accessBlocked('The temporary access could not be restored; its restoration remains saved');
  a.failure='The bounded local repair failed; the design and progress are saved';a.phase='restoring';checkpoint(bot,goal,save);return true;
 }
 // A construction step can acquire a missing tool without performing the dig.
 // Only observed air proves that the access was actually opened.
 if(a.phase==='opening'&&air(bot.blockAt(vec(a.opening)))){a.phase='repairing';checkpoint(bot,goal,save);}
 return true;
}
module.exports={accessBlocked,openingCandidates,startOpening,continueOpening,safeOpening};
