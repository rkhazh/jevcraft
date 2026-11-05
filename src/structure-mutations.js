'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {Vec3}=require('vec3');
const {actionAttribution}=require('./action-scope');
const authority=require('./mutation-authority');
const permits=new AsyncLocalStorage(),dispatches=new AsyncLocalStorage(),expectations=new AsyncLocalStorage(),expectationClients=new WeakSet(),expectationUpdates=new WeakSet(),key=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const expectationRefused=()=>Object.assign(new Error('Mutation expectation expired or the exact recorded block changed before dispatch'),{name:'StructureMutationRefused'});
function checkExpectation(scope,bot,operation,p){
 for(let expected=scope;expected;expected=expected.parent){
  if(expected.bot!==bot)continue;
  if(expected.error)throw expected.error;
  if(!expected.active||expected.client!==bot._client||expected.dimension!==bot.game?.dimension||expected.operation!==operation||expected.cell!==key(p))throw expectationRefused();
  expected.check?.();
  const block=bot.blockAt(p);
  if(!block||block.name!==expected.name||block.stateId!==expected.stateId)throw expectationRefused();
 }
}
function installExpectationFence(bot){
 const client=bot._client;
 if(!client||typeof client.write!=='function')throw new Error('A network dispatch guard is required for a mutation expectation');
 if(!expectationClients.has(client)){
  expectationClients.add(client);const write=client.write;
  client.write=function(name,packet){
   const scope=expectations.getStore();
   if(!scope||scope.bot!==bot)return write.call(this,name,packet);
   const operation=name==='block_dig'&&[0,2].includes(packet.status)?'dig':name==='block_place'?'place':null;
   if(!operation)return write.call(this,name,packet); // Dig cancellation remains available.
   try{checkExpectation(scope,bot,operation,packet.location);}
   catch(error){
    scope.error=error;const dispatch=dispatches.getStore();if(dispatch?.bot===bot)dispatch.error=error;
    if(operation==='dig'&&packet.status===2){try{bot.stopDigging?.();}catch(_){}return false;}
    throw error;
   }
   return write.call(this,name,packet);
  };
 }
 if(!expectationUpdates.has(bot)&&typeof bot._updateBlockState==='function'){
  expectationUpdates.add(bot);const update=bot._updateBlockState;
  bot._updateBlockState=function(p,state){
   const expected=expectations.getStore();
   if(expected?.bot===bot&&expected.error&&expected.cell===key(p)&&state===0)return;
   return update.call(this,p,state);
  };
 }
}
// Validation only: this never creates a build permit or changes the ordinary
// registered-structure check. Equip/look/timer waits all retain this scope.
async function withMutationExpectation(bot,{operation,position,name,stateId,check},run){
 if(operation!=='dig'||!position||!['x','y','z'].every(k=>Number.isInteger(position[k]))||typeof name!=='string'||!Number.isInteger(stateId)||stateId<0||check!==undefined&&typeof check!=='function')throw new Error('An exact dig position, material and state are required');
 installExpectationFence(bot);
 const p=new Vec3(position.x,position.y,position.z),scope={bot,client:bot._client,dimension:bot.game?.dimension,operation,cell:key(p),name,stateId,check,parent:expectations.getStore(),active:true,error:null};
 checkExpectation(scope,bot,operation,p);
 try{const result=await expectations.run(scope,run);if(scope.error)throw scope.error;return result;}
 catch(error){throw scope.error||error;}finally{scope.active=false;}
}
function mutationCells(bot,operation,p){
 const block=operation==='dig'?bot.blockAt(p):null,material=block?.name||bot.heldItem?.name,properties=block?.getProperties?.()||{};
 if(operation==='place'&&authority.hasMutationAuthority(bot))require('./build-blocks').assertPlacementFootprint(bot,p,material);
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
 const attribution=permit=>{
  const current=actionAttribution(bot);
  // A validated explicit build operation also identifies standalone callers.
  return current.controller==='unknown'&&permit?{controller:'work',goal_id:permit.goal.personaGoalId||null,interrupted_goal_id:null}:current;
 };
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
 const authorityRefused=(operation,p,reason)=>Object.assign(new Error(`Shared-world ${operation} refused at (${p?.x}, ${p?.y}, ${p?.z}): ${reason}`),{name:'StructureMutationRefused',mutationReason:reason});
 function placedBlockName(reference,direction){
  const name=bot.heldItem?.name;
  if(bot.registry?.blocksByName?.[name])return name;
  // The existing village replant operation uses these three ordinary crops:
  // an upward click on farmland places exactly one cell above it.
  const crop={wheat_seeds:'wheat',carrot:'carrots',potato:'potatoes'}[name];
  if(crop&&direction===1&&bot.blockAt(reference)?.name==='farmland'&&bot.registry?.blocksByName?.[crop])return crop;
  throw authorityRefused('place',reference,'unsupported_item_block_effect');
 }
 function checkReferenceEffect(reference,direction,cursorY){
  const block=bot.blockAt(reference),name=bot.heldItem?.name,p=block?.getProperties?.()||{},same=block?.name===name;
  const merging=same&&(/_slab$/.test(name)&&(!['bottom','top','double'].includes(p.type)||p.type!=='double'&&(p.type==='bottom'?direction===1||direction>1&&(!Number.isFinite(cursorY)||cursorY>.5):direction===0||direction>1&&(!Number.isFinite(cursorY)||cursorY<=.5)))||name==='snow'&&!(p.layers>=8)||/(?:^|_)candle$/.test(name)&&!(p.candles>=4)||name==='sea_pickle'&&!(p.pickles>=4)||name==='turtle_egg'&&!(p.eggs>=4));
  const useOn=block?.name==='flower_pot'||block?.name==='composter'||block?.name==='respawn_anchor'&&name==='glowstone'||block?.name==='cake'&&/(?:^|_)candle$/.test(name);
  if(!block||block.boundingBox!=='block'||merging||useOn)throw authorityRefused('place',reference,'unsupported_reference_block_effect');
 }
 function permission(operation,p,cells,permit){
  const attempted=permits.getStore(),build=attempted?.bot===bot;
  if(build&&!permit)return {allowed:false,reason:'validated_build_operation_required'};
  const results=cells.map(cell=>authority.queryMutation(bot,operation,cell,{build,projectId:permit?.goal.buildId}));
  return results.find(r=>!r.allowed)||{...results[0],restores:Object.fromEntries(results.flatMap((r,i)=>r.restore?[[key(cells[i]),r.restore]]:[]))};
 }
 // Mineflayer waits for lookAt before dispatch, and finishes digs in a timer.
 // Recheck at the actual write rather than trusting an earlier wrapper check.
 const write=bot._client?.write;
 if(typeof write==='function')bot._client.write=function(name,packet){
  const current=dispatches.getStore(),scope=current?.bot===bot?current:null;
  const shared=authority.hasMutationAuthority(bot);
  if(shared&&name==='use_item'){
   const held=packet.hand===1?bot.inventory?.slots?.[45]:bot.heldItem;
   if(!authority.mutationAuthorityCurrent(bot))throw authorityRefused('use_item',null,'mutation_authority_session_closed');
   // Bucket use raycasts its own target; this packet carries no cell that our
   // dig/place contract can validate. Milk is a consumable, not a world edit.
   if(/(?:^|_)bucket$/.test(held?.name||'')&&held.name!=='milk_bucket')throw authorityRefused('use_item',null,'unsupported_item_world_effect');
  }
  if(shared&&name==='block_place'&&scope?.operation==='interact'){
   if(!scope.active||scope.client!==bot._client||scope.dimension!==bot.game?.dimension||!authority.mutationAuthorityCurrent(bot)||packet.hand===1||bot.heldItem||!packet.location||key(packet.location)!==key(scope.p)||bot.blockAt(scope.p)?.name!==scope.blockName||!authority.blockInteractionSupport(bot,scope.blockName,null).allowed)throw authorityRefused('interact',packet.location,'interaction_requires_current_empty_hand');
   return write.call(this,name,packet);
  }
  const operation=name==='block_dig'&&[0,2].includes(packet.status)?'dig':name==='block_place'&&(scope?.operation==='place'||shared)?'place':null;
  if(!operation)return write.call(this,name,packet);
  const offset=[[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]][packet.direction];
  const location=packet.location,p=operation==='dig'?new Vec3(location.x,location.y,location.z):offset?new Vec3(location.x+offset[0],location.y+offset[1],location.z+offset[2]):scope?.p;
  let error=null;
  try{
   if(shared&&(!scope||!scope.active||!authority.mutationAuthorityCurrent(bot)||scope.client!==bot._client||scope.dimension!==bot.game?.dimension||scope.operation!==operation||!p||key(scope.p)!==key(p)))throw authorityRefused(operation,p,'mutation_requires_current_method_scope');
   if(operation==='place'&&packet.hand===1)throw refuse(operation,p);
   if(shared&&operation==='place'){scope.placedName=placedBlockName(location,packet.direction);checkReferenceEffect(location,packet.direction,packet.cursorY);}
   const cells=mutationCells(bot,operation,p),permit=permitFor(operation,p,cells);
   if(scope&&operation==='place')scope.placedCells=cells;
   if(scope)scope.attribution=attribution(permit);
   if(scope?.permit&&!permit||!shared&&cells.some(protectedAt)&&!permit&&!suffocationEscape(operation,p))error=refuse(operation,p);
   const allowed=permission(operation,p,cells,permit);
   if(scope)scope.restores=allowed.restores;
   if(!error&&!allowed.allowed&&!cells.every(cell=>suffocationEscape(operation,cell)))error=authorityRefused(operation,p,allowed.reason);
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
   audit({operation,position:{x:p?.x,y:p?.y,z:p?.z},status:'dispatch_refused',reason:error.mutationReason||'registered_structure_or_expired_permit',...(scope?.attribution||attribution(null))});
   if(scope)scope.error=error;
   if(operation==='dig'&&packet.status===2){bot.stopDigging?.();return false;}
   throw error;
  }
  if(scope)scope.dispatched=true;
  return write.call(this,name,packet);
 };
 const update=bot._updateBlockState;
 if(typeof update==='function')bot._updateBlockState=function(p,state){
  const scope=dispatches.getStore();
  if(scope?.bot===bot&&scope.error&&scope.operation==='dig'&&key(p)===key(scope.p)&&state===0)return;
  return update.call(this,p,state);
 };
 const activate=bot.activateBlock;
 if(typeof activate==='function')bot.activateBlock=async function(block,...args){
  if(!authority.hasMutationAuthority(bot))return activate.call(this,block,...args);
  const current=block?.position&&bot.blockAt(block.position),support=authority.blockInteractionSupport(bot,current?.name,bot.heldItem?.name);
  if(!support.allowed)throw authorityRefused('interact',block?.position,support.reason);
  const scope={bot,p:block?.position,blockName:current?.name,operation:'interact',client:bot._client,dimension:bot.game?.dimension,active:true};
  try{
   await require('./skills').emptyHand(bot);
   if(bot.heldItem||!scope.p||!authority.mutationAuthorityCurrent(bot))throw authorityRefused('interact',scope.p,'empty_hand_unavailable_for_interaction');
   // The next skill equips what it needs; restoring an old tool could overwrite
   // a newer controller's hand after this awaited interaction.
   return await dispatches.run(scope,()=>activate.call(this,block,...args));
  }finally{scope.active=false;}
 };
 for(const [method,operation]of [['dig','dig'],['placeBlock','place'],['_placeBlockWithOptions','place']]){
  const original=bot[method];if(typeof original!=='function')continue;
  bot[method]=async function(...args){
   const p=operation==='dig'?args[0]?.position:args[0]?.position?.plus(args[1]);
   if(!p)return original.apply(this,args);
   if(!authority.mutationAuthorityCurrent(bot))throw authorityRefused(operation,p,'mutation_authority_session_closed');
   if(operation==='place'&&args[2]?.offhand)throw refuse(operation,p);
   if(operation==='place'&&authority.hasMutationAuthority(bot))placedBlockName(args[0].position,args[1]?.y===1?1:-1);
   const cells=mutationCells(bot,operation,p),protectedCell=cells.some(protectedAt),permit=permitFor(operation,p,cells),allowed=permission(operation,p,cells,permit),emergency=!permit&&cells.every(cell=>suffocationEscape(operation,cell));
   if(!authority.hasMutationAuthority(bot)&&protectedCell&&!permit&&!emergency){audit({operation,position:{x:p.x,y:p.y,z:p.z},status:'refused',reason:'registered_structure',...attribution(null)});throw refuse(operation,p);}
   if(!allowed.allowed&&!emergency){audit({operation,position:{x:p.x,y:p.y,z:p.z},status:'refused',reason:allowed.reason,...attribution(null)});throw authorityRefused(operation,p,allowed.reason);}
   const witness={client:bot._client,dimension:bot.game?.dimension};
   const before=bot.blockAt(p);let acknowledgedState=null,placed=false;
   const ack=packet=>{if(packet.location&&key(packet.location)===key(p))acknowledgedState=packet.type;};
   let succeeded=false;const dispatch={bot,p,operation,permit,error:null,active:true,dispatched:false,attribution:attribution(permit),...witness},pairUpdates=new Map();
   const pairUpdate=(old,block)=>{if(dispatch.active&&dispatch.dispatched&&block?.position&&dispatch.placedCells?.some(c=>key(c)===key(block.position))&&['air','cave_air','void_air'].includes(old?.name))pairUpdates.set(key(block.position),block.stateId);};
   const placement=(_old,block)=>{if(block?.position&&key(block.position)===key(p)){
    placed=true;acknowledgedState=block.stateId;
    if(!dispatch.active||!dispatch.dispatched||block.name!==dispatch.placedName)return;
    authority.noteConfirmedPlacement(bot,block,{...witness,restore:dispatch.restores?.[key(block.position)]});
    for(const cell of dispatch.placedCells?.slice(1)||[]){
     const companion=bot.blockAt(cell),a=block.getProperties?.()||{},b=companion?.getProperties?.()||{};
     const pair=/_bed$/.test(block.name)?require('./build-blocks').bedPairMatches(block,companion):/_door$/.test(block.name)&&a.half==='lower'&&b.half==='upper'&&['facing','hinge','open','powered'].every(k=>a[k]===b[k]);
     if(companion?.name===block.name&&pair&&pairUpdates.get(key(cell))===companion.stateId)authority.noteConfirmedPlacement(bot,companion,{...witness,restore:dispatch.restores?.[key(companion.position)]});
    }
   }};
   bot._client?.on('block_change',ack);bot.on?.('blockPlaced',placement);bot.on?.('blockUpdate',pairUpdate);
   try{authority.mutationStarted(bot,operation,cells);const result=await dispatches.run(dispatch,()=>original.apply(this,args));if(dispatch.error)throw dispatch.error;succeeded=true;return result;}catch(err){throw dispatch.error||err;}
   finally{
    dispatch.active=false;
    witness.client?.removeListener('block_change',ack);bot.removeListener?.('blockPlaced',placement);bot.removeListener?.('blockUpdate',pairUpdate);
    const after=bot.blockAt(p);
    audit({operation,position:{x:p.x,y:p.y,z:p.z},status:succeeded?'returned':'failed',requested_by_bot:true,registered:protectedCell,restoration:allowed.restoration||null,permission:permit?'validated_build_cell':emergency?'body_intersection_escape':allowed.source==='upstream'?'unregistered_cell':allowed.source,...dispatch.attribution,build_id:permit?.goal.buildId||null,before:{name:before?.name,state_id:before?.stateId},after:{name:after?.name,state_id:after?.stateId},server_update_observed:acknowledgedState!==null,server_state_id:acknowledgedState,own_placement_event:placed,observed_change:acknowledgedState!==null&&acknowledgedState!==before?.stateId});
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
 const protectedAt=bot._registeredStructureProtection||(()=>false);
 return (move.toBreak||[]).some(p=>{try{return mutationCells(bot,'dig',new Vec3(p.x,p.y,p.z)).some(q=>!authority.hasMutationAuthority(bot)&&protectedAt(q)||!authority.queryMutation(bot,'dig',q).allowed);}catch{return true;}})||(move.toPlace||[]).some(p=>{
  if(p.useOne)return false; // Door activation, not placement.
  const q=new Vec3(p.x+(p.dx||0),p.y+(p.dy||0),p.z+(p.dz||0));return !authority.hasMutationAuthority(bot)&&protectedAt(q)||!authority.queryMutation(bot,'place',q).allowed;
 });
}
module.exports={installStructureMutationGuard,withBuildMutation,withMutationExpectation,routeMutatesStructure,mutationCells};
