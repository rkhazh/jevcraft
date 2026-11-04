'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {Vec3}=require('vec3');
const permits=new AsyncLocalStorage(),dispatches=new AsyncLocalStorage(),key=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
function mutationCells(bot,operation,p){
 const block=operation==='dig'?bot.blockAt(p):null,material=block?.name||bot.heldItem?.name,properties=block?.getProperties?.()||{};
 if(operation==='dig'&&material?.endsWith('_door')&&!['upper','lower'].includes(properties.half))throw new Error('Unknown door half');
 if(material?.endsWith('_door'))return [p,p.offset(0,operation==='dig'&&properties.half==='upper'?-1:1,0)];
 if(material?.endsWith('_bed')){
  if(operation==='dig'&&!['head','foot'].includes(properties.part))throw new Error('Unknown bed half');
  const quadrant=((Math.round((bot.entity?.yaw||0)/(Math.PI/2))%4)+4)%4;
  const facing=operation==='dig'?properties.facing:['north','west','south','east'][quadrant];
  const delta={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]}[facing];
  if(!delta)throw Object.assign(new Error('Cannot prove paired block mutation footprint'),{name:'StructureMutationRefused'});
  const sign=operation==='dig'&&properties.part==='head'?-1:1;return [p,p.offset(delta[0]*sign,0,delta[1]*sign)];
 }
 return [p];
}
function installStructureMutationGuard(bot,{validGoal=()=>false,record=()=>{}}={}){
 if(bot._registeredStructureProtection)return;
 let cache=null,records=0;
 const protectedAt=p=>{
  if(!p)return false;
  const registry=bot.buildRegistry,dimension=String(bot.game?.dimension||'').replace(/^minecraft:/,''),now=Date.now();
  if(!registry)return false;
  if(!cache||cache.registry!==registry||cache.version!==registry.serialized||cache.dimension!==dimension||now-cache.at>250){
   const cells=new Set();for(const entry of registry.all(dimension))for(const cell of [...(entry.blueprint?.blocks||[]),...(entry.blueprint?.empty||[])])cells.add(key(cell));
   cache={registry,version:registry.serialized,dimension,at:now,cells};
  }
  return cache.cells.has(key(p));
 };
 const audit=data=>{if(records++<512)record({at:Date.now()/1000,dimension:String(bot.game?.dimension||''),...data});};
 bot._registeredStructureProtection=protectedAt;
 bot._structureMutationPermitValid=validGoal;
 function permitFor(operation,p,cells){
  const permit=permits.getStore();
  if(!permit||!permit.active||permit.bot!==bot||permit.operation!==operation||permit.cell!==key(p)||!validGoal(permit.goal))return null;
  permit.task.check();
  if(permit.validate&&!permit.validate())return null;
  // Admission is not an enduring right to clear a later human replacement.
  if(!cells.every(cell=>permit.cells.has(key(cell))&&(require('./designer').canClearSchematicBlock(permit.goal.blueprint,permit.goal.buildOwned,bot.blockAt(cell))||operation==='dig'&&bot._restorationPermit?.allows(bot,permit.goal,cell,permit.restorations.get(key(cell))))))return null;
  return permit;
 }
 function suffocationEscape(operation,p){
  if(operation!=='dig'||!bot.entity?.position)return false;
  // Only a solid actually intersecting this body's feet/head; old stances,
  // distant hostiles and general resource work cannot grant a mutation.
  return [0,1.62].some(y=>{const point=bot.entity.position.offset(0,y,0),q=point.floored(),b=bot.blockAt(q);return key(q)===key(p)&&b?.shapes?.some(s=>point.x-q.x>s[0]&&point.x-q.x<s[3]&&point.y-q.y>s[1]&&point.y-q.y<s[4]&&point.z-q.z>s[2]&&point.z-q.z<s[5]);});
 }
 const refuse=(operation,p)=>Object.assign(new Error(`Registered structure mutation refused at (${p.x}, ${p.y}, ${p.z}); no current validated build operation`),{name:'StructureMutationRefused'});
 // Mineflayer waits for lookAt before dispatch, and finishes digs in a timer.
 // Recheck at the actual write rather than trusting an earlier wrapper check.
 const write=bot._client?.write;
 if(typeof write==='function')bot._client.write=function(name,packet){
  const current=dispatches.getStore(),scope=current?.bot===bot?current:null;
  const operation=name==='block_dig'&&[0,2].includes(packet.status)?'dig':name==='block_place'&&scope?.operation==='place'?'place':null;
  if(!operation)return write.call(this,name,packet);
  const offset=[[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]][packet.direction];
  const location=packet.location,p=operation==='dig'?new Vec3(location.x,location.y,location.z):offset?new Vec3(location.x+offset[0],location.y+offset[1],location.z+offset[2]):scope.p;
  let error=null;
  try{
   if(operation==='place'&&packet.hand===1)throw refuse(operation,p);
   const cells=mutationCells(bot,operation,p),permit=permitFor(operation,p,cells);
   if(scope?.permit&&!permit||cells.some(protectedAt)&&!permit&&!suffocationEscape(operation,p))error=refuse(operation,p);
   if(!error&&permit&&operation==='dig'){
    const restore=cells.filter(cell=>!require('./designer').canClearSchematicBlock(permit.goal.blueprint,permit.goal.buildOwned,bot.blockAt(cell)));
    if(restore.length){
     if(!scope||packet.status===0&&(scope.restorationStarted||permit.restorations.size)||packet.status===2&&(!scope.restorationStarted||scope.restorationFinished))throw refuse(operation,p);
     for(const cell of restore){const token=permit.restorations.get(key(cell));if(packet.status!==0&&!token)throw refuse(operation,p);permit.restorations.set(key(cell),bot._restorationPermit.claim(bot,permit.goal,cell,token));}
     scope.restorationStarted=true;if(packet.status===2)scope.restorationFinished=true;
    }
    if(!permitFor(operation,p,cells))error=refuse(operation,p);
   }
  }catch(err){error=err;}
  if(error){
   audit({operation,position:{x:p.x,y:p.y,z:p.z},status:'dispatch_refused',reason:'registered_structure_or_expired_permit'});
   if(scope)scope.error=error;
   if(operation==='dig'&&packet.status===2){bot.stopDigging?.();return false;}
   throw error;
  }
  return write.call(this,name,packet);
 };
 const update=bot._updateBlockState;
 if(typeof update==='function')bot._updateBlockState=function(p,state){
  const scope=dispatches.getStore();
  if(scope?.bot===bot&&scope.error&&scope.operation==='dig'&&key(p)===key(scope.p)&&state===0)return;
  return update.call(this,p,state);
 };
 for(const [method,operation]of [['dig','dig'],['placeBlock','place'],['_placeBlockWithOptions','place']]){
  const original=bot[method];if(typeof original!=='function')continue;
  bot[method]=async function(...args){
   const p=operation==='dig'?args[0]?.position:args[0]?.position?.plus(args[1]);
   if(!p)return original.apply(this,args);
   if(operation==='place'&&args[2]?.offhand)throw refuse(operation,p);
   const cells=mutationCells(bot,operation,p),protectedCell=cells.some(protectedAt),permit=permitFor(operation,p,cells),emergency=protectedCell&&!permit&&suffocationEscape(operation,p);
   if(protectedCell&&!permit&&!emergency){audit({operation,position:{x:p.x,y:p.y,z:p.z},status:'refused',reason:'registered_structure',goal_id:bot._goal?.personaGoalId||null});throw refuse(operation,p);}
   const before=bot.blockAt(p);let acknowledgedState=null,placed=false;
   const ack=packet=>{if(packet.location&&key(packet.location)===key(p))acknowledgedState=packet.type;};
   const placement=(_old,block)=>{if(block?.position&&key(block.position)===key(p)){placed=true;acknowledgedState=block.stateId;}};
   bot._client?.on('block_change',ack);bot.on?.('blockPlaced',placement);
   let succeeded=false;const dispatch={bot,p,operation,permit,error:null};
   try{const result=await dispatches.run(dispatch,()=>original.apply(this,args));if(dispatch.error)throw dispatch.error;succeeded=true;return result;}catch(err){throw dispatch.error||err;}
   finally{
    bot._client?.removeListener('block_change',ack);bot.removeListener?.('blockPlaced',placement);
    const after=bot.blockAt(p);
    audit({operation,position:{x:p.x,y:p.y,z:p.z},status:succeeded?'returned':'failed',requested_by_bot:true,registered:protectedCell,permission:permit?'validated_build_cell':emergency?'body_intersection_escape':'unregistered_cell',goal_id:permit?.goal.personaGoalId||bot._goal?.personaGoalId||null,build_id:permit?.goal.buildId||null,before:{name:before?.name,state_id:before?.stateId},after:{name:after?.name,state_id:after?.stateId},server_update_observed:acknowledgedState!==null,server_state_id:acknowledgedState,own_placement_event:placed,observed_change:acknowledgedState!==null&&acknowledgedState!==before?.stateId});
   }
  };
 }
}
async function withBuildMutation(bot,task,goal,p,operation,run,{cells,validate}={}){
 if(!bot._registeredStructureProtection)return run();
 if(goal?.kind!=='build'||!goal.blueprint||!bot._structureMutationPermitValid?.(goal))throw new Error('Validated current build goal required for mutation permit');
 const footprint=operation==='dig'?mutationCells(bot,operation,p):cells||[p];
 const permit={bot,task,goal,cell:key(p),cells:new Set(footprint.map(key)),restorations:new Map(),operation,validate,active:true};
 try{return await permits.run(permit,run);}finally{permit.active=false;}
}
function routeMutatesStructure(bot,move){
 const protectedAt=bot._registeredStructureProtection;if(!protectedAt)return false;
 return (move.toBreak||[]).some(p=>{try{return mutationCells(bot,'dig',new Vec3(p.x,p.y,p.z)).some(protectedAt);}catch{return true;}})||(move.toPlace||[]).some(p=>protectedAt(new Vec3(p.x+(p.dx||0),p.y+(p.dy||0),p.z+(p.dz||0))));
}
module.exports={installStructureMutationGuard,withBuildMutation,routeMutatesStructure,mutationCells};
