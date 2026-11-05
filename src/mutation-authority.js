'use strict';
// Trusted startup policy + confirmed own placements. Model goals, site guesses,
// old laid maps and nearby block changes cannot create an authorization here.
const fs=require('node:fs'),{Vec3}=require('vec3');
const authorities=new WeakMap(),validated=new WeakSet(),MAX_BYTES=131072,MAX_RECEIPTS=512;
const OPERATIONS=['dig','place','container_withdraw','entity_attack'];
const ITEM_STORES=new Set(['chest','trapped_chest','barrel','ender_chest','shulker_box','furnace','blast_furnace','smoker','hopper','dropper','dispenser','brewing_stand','crafter','lectern','decorated_pot','chiseled_bookshelf','jukebox']);
const text=(s,n=128)=>typeof s==='string'&&s.length>0&&s.length<=n&&!/[\p{Cc}\p{Cf}]/u.test(s);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,required,optional=[])=>object(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
const dimension=d=>typeof d==='string'?d.replace(/^minecraft:/,''):'';
const dimensionOK=d=>typeof d==='string'&&/^(?:minecraft:)?(?:overworld|the_nether|the_end)$/.test(d);
const point=p=>keys(p,['x','y','z'])&&['x','y','z'].every(k=>Number.isInteger(p[k]))&&Math.abs(p.x)<=29999984&&Math.abs(p.z)<=29999984&&p.y>=-64&&p.y<=319;
const key=p=>`${p.x},${p.y},${p.z}`,receiptKey=(d,p)=>`${d}:${key(p)}`;
const air=b=>!!b&&['air','cave_air','void_air'].includes(b.name);
const bad=()=>new Error('Invalid shared-world mutation policy');
function freeze(v){if(object(v)||Array.isArray(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function validateMutationAuthority(value,{worldId,principal}={}){
 if(!keys(value,['version','world_id','principal','temporary_empty_placement','grants'])||value.version!==1||!text(worldId)||!text(principal)||value.world_id!==worldId||value.principal!==principal||typeof value.temporary_empty_placement!=='boolean'||!Array.isArray(value.grants)||value.grants.length>32)throw bad();
 let bytes;try{bytes=Buffer.byteLength(JSON.stringify(value));}catch{throw bad();}if(bytes>MAX_BYTES)throw bad();
 const ids=new Set();let cells=0;
 for(const g of value.grants){
  if(!keys(g,['id','dimension','operations','source'],['project_id','cells','area','expires_at'])||!text(g.id)||ids.has(g.id)||!dimensionOK(g.dimension)||!text(g.source,512)||!Array.isArray(g.operations)||!g.operations.length||g.operations.length>OPERATIONS.length||new Set(g.operations).size!==g.operations.length||g.operations.some(x=>!OPERATIONS.includes(x))||g.project_id!==undefined&&!text(g.project_id)||g.expires_at!==undefined&&(!Number.isFinite(g.expires_at)||g.expires_at<0)||Object.hasOwn(g,'cells')===Object.hasOwn(g,'area'))throw bad();
  ids.add(g.id);
  if(g.cells){if(!Array.isArray(g.cells)||!g.cells.length||g.cells.some(p=>!point(p))||new Set(g.cells.map(key)).size!==g.cells.length)throw bad();cells+=g.cells.length;}
  else if(!keys(g.area,['min','max'])||!point(g.area.min)||!point(g.area.max)||['x','y','z'].some(k=>g.area.min[k]>g.area.max[k]))throw bad();
 }
 if(cells>4096)throw bad();
 const policy=structuredClone(value);for(const g of policy.grants)g.dimension=dimension(g.dimension);
 freeze(policy);validated.add(policy);return policy;
}
function loadMutationAuthority(path,scope){
 let fd;
 try{
  fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>MAX_BYTES)throw bad();
  const data=Buffer.alloc(MAX_BYTES+1);let length=0;
  while(length<data.length){const n=fs.readSync(fd,data,length,data.length-length,null);if(!n)break;length+=n;}
  if(length>MAX_BYTES)throw bad();
  const raw=new TextDecoder('utf8',{fatal:true}).decode(data.subarray(0,length)),value=JSON.parse(raw),stack=[];
  // JSON.parse accepts duplicate object members; an operator-reviewed policy
  // must have one unambiguous value for each permission field.
  for(let i=0;i<raw.length;i++){
   const c=raw[i];if(c==='{'||c==='[')stack.push(c==='{'?new Set():null);
   else if(c==='}'||c===']')stack.pop();
   else if(c==='"'){
    const start=i++;for(;i<raw.length;i++){if(raw[i]==='\\')i++;else if(raw[i]==='"')break;}
    let next=i+1;while(/\s/.test(raw[next]||'')&&next<raw.length)next++;
    if(raw[next]===':'){const name=JSON.parse(raw.slice(start,i+1)),names=stack.at(-1);if(names.has(name))throw bad();names.add(name);}
   }
  }
  return validateMutationAuthority(value,scope);
 }catch{throw bad();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
const validProperties=p=>object(p)&&Object.keys(p).length<=24&&Object.entries(p).every(([k,v])=>text(k,64)&&(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.length<=64));
function properties(block){try{const p=block.getProperties?.()||{};return validProperties(p)?{...p}:null;}catch{return null;}}
function sameBlock(receipt,block){
 receipt=receipt.current||receipt;
 if(!block||block.name!==receipt.material)return false;
 if(block.stateId===receipt.state_id)return true;
 const current=properties(block),before=receipt.properties;if(!current||!before)return false;
 // Ordinary open/power or furnace-light changes do not transfer ownership.
 // Orientation, halves, waterlogging and all unknown changes remain exact.
 const dynamic=/_(door|trapdoor|fence_gate)$/.test(block.name)?new Set(['open','powered']):/_bed$/.test(block.name)?new Set(['occupied']):['furnace','blast_furnace','smoker','redstone_lamp'].includes(block.name)?new Set(['lit']):block.name==='grass_block'?new Set(['snowy']):['wheat','carrots','potatoes'].includes(block.name)?new Set(['age']):new Set();
 const all=new Set([...Object.keys(before),...Object.keys(current)]);
 return dynamic.size>0&&[...all].some(k=>dynamic.has(k)&&before[k]!==current[k])&&[...all].every(k=>Object.hasOwn(before,k)&&Object.hasOwn(current,k)&&(dynamic.has(k)||before[k]===current[k]));
}
function active(a,bot){return !!a&&a.live&&a.client===bot._client&&a.principal===bot.username&&a.isCurrent();}
function persist(a,revocation=false){
 if(a.live&&a.isCurrent())try{a.world.store.save({version:1,known:a.world.known});if(revocation)a.world.store.flushSync?.();}
 catch{a.live=false;throw Object.assign(new Error('Cannot persist shared-world mutation authority; edits are disabled'),{name:'MutationAuthorityPersistenceError'});}
}
function grassGrowth(a,r,block){
 if(r.material!=='dirt'||r.current||block?.name!=='grass_block'||!Number.isInteger(block.stateId)||!properties(block))return false;
 // Preserve the original confirmed dirt receipt; this is a one-way observed
 // natural evolution, not an equivalence between soil materials.
 r.current={material:block.name,state_id:block.stateId,properties:properties(block)};persist(a);return true;
}
function validReceipt(r,a){return keys(r,['world_id','principal','dimension','position','material','state_id','properties','at','source'],['current','restore','revoked'])&&(!r.restore||keys(r.restore,['project_id','expected'])&&text(r.restore.project_id)&&r.restore.expected==='air')&&(r.revoked===undefined||r.revoked===true&&!!r.restore)&&r.world_id===a.worldId&&r.principal===a.principal&&dimensionOK(r.dimension)&&r.dimension===dimension(r.dimension)&&point(r.position)&&text(r.material)&&Number.isInteger(r.state_id)&&r.state_id>=0&&validProperties(r.properties)&&Number.isFinite(r.at)&&r.at>=0&&r.source==='bot_block_placed'&&(!r.current||r.material==='dirt'&&keys(r.current,['material','state_id','properties'])&&r.current.material==='grass_block'&&Number.isInteger(r.current.state_id)&&r.current.state_id>=0&&validProperties(r.current.properties));}
// A reservation describes the desired result, not land ownership. Only a
// trusted project grant may temporarily occupy its exclusive desired air.
function reservationsAt(bot,p){
 const d=dimension(bot.game?.dimension),k=key(p),claims=[];
 for(const entry of bot.buildRegistry?.all(d)||[])for(const [role,cells]of [['solid',entry.blueprint?.blocks],['air',entry.blueprint?.empty]])
  if(cells?.some(cell=>key(cell)===k))claims.push({project_id:entry.id,role,from:entry.from,status:entry.status});
 return claims;
}
function matchingGrant(a,operation,p,d,projectId,{projectOnly=false}={}){
 return a.grants.find(({value:g,cells})=>g.dimension===d&&g.operations.includes(operation)&&(g.expires_at===undefined||a.now()<g.expires_at)&&
  (projectOnly?g.project_id===projectId:g.project_id===undefined||g.project_id===projectId)&&
  (cells?cells.has(key(p)):['x','y','z'].every(k=>p[k]>=g.area.min[k]&&p[k]<=g.area.max[k])))?.value;
}
function reconcileReceipt(a,k,block){
 const kept=a.world.known.mutationReceipts,r=kept[k];if(!r||!block)return r;
 if(r.restore&&air(block)){if(a.awaitingAir.has(k))return r;delete kept[k];persist(a,true);return null;}
 if(r.revoked)return r;
 if(!sameBlock(r,block)&&!grassGrowth(a,r,block)){
  if(r.restore)r.revoked=true;else delete kept[k];
  persist(a,true);return kept[k]||null;
 }
 return r;
}
function pendingRestorations(bot){
 const a=authorities.get(bot);if(!active(a,bot))return [];
 const d=dimension(bot.game?.dimension),pending=[];
 for(const [k,r]of Object.entries(a.world.known.mutationReceipts))if(r.restore&&r.dimension===d){
  const current=reconcileReceipt(a,k,bot.blockAt(new Vec3(r.position.x,r.position.y,r.position.z)));
  if(current)pending.push(structuredClone(current));
 }
 return pending.sort((x,y)=>x.at-y.at);
}
function installMutationAuthority(bot,{policy,worldId,principal,world,isCurrent=()=>true,now=()=>Date.now()/1000}){
 if(!validated.has(policy)||policy.world_id!==worldId||policy.principal!==principal||!object(world?.known)||typeof world.store?.save!=='function'||authorities.has(bot))throw bad();
 const a={policy,worldId,principal,world,isCurrent,now,client:bot._client,live:true,awaitingAir:new Set(),grants:policy.grants.map(g=>({value:g,cells:g.cells&&new Set(g.cells.map(key))}))};
 const kept=Object.create(null);
 for(const r of Object.values(world.known.mutationReceipts||{}).filter(r=>validReceipt(r,a)).sort((x,y)=>x.at-y.at).slice(-MAX_RECEIPTS))kept[receiptKey(r.dimension,r.position)]=structuredClone(r);
 world.known.mutationReceipts=kept;authorities.set(bot,a);
 const update=(old,block)=>{
  if(!active(a,bot)||!block?.position)return;
  const k=receiptKey(dimension(bot.game?.dimension),block.position),r=kept[k];if(!r)return;
  if(r.restore&&air(block)){reconcileReceipt(a,k,block);return;}
  // A failed dig can put the original block back over Mineflayer's local
  // optimistic air. This is not an observed server removal/replacement.
  const originalEcho=r.restore&&a.awaitingAir.has(k)&&sameBlock(r,block);
  if(old&&!sameBlock(r,old)&&!originalEcho){if(r.restore)r.revoked=true;else delete kept[k];persist(a,true);return;}
  if(!reconcileReceipt(a,k,block)||r.revoked)return;
  else {const current=r.current||r;if(block.stateId!==current.state_id){current.state_id=block.stateId;current.properties=properties(block);persist(a);}}
 };
 const stopServer=require('./server-truth').observeServerBlocks(bot,(x,y,z,state)=>{
  if(!active(a,bot))return;
  const p=new Vec3(x,y,z),k=receiptKey(dimension(bot.game?.dimension),p),r=kept[k];if(!r?.restore)return;
  if(state===0){delete kept[k];a.awaitingAir.delete(k);persist(a,true);}
  else if(bot.blockAt(p)?.stateId===state)a.awaitingAir.delete(k);
 });
 bot.on?.('blockUpdate',update);
 return {close(){a.live=false;bot.removeListener?.('blockUpdate',update);stopServer();},summary:()=>mutationAuthoritySummary(bot)};
}
// Called only by the guard's confirmed blockPlaced listener, with the client
// and dimension captured before the awaited placement began.
function noteConfirmedPlacement(bot,block,witness){
 const a=authorities.get(bot),d=dimension(bot.game?.dimension),p=block?.position;
 if(!active(a,bot)||witness?.client!==a.client||dimension(witness?.dimension)!==d||!point(p&&{x:p.x,y:p.y,z:p.z})||air(block)||!text(block?.name)||!Number.isInteger(block?.stateId)||block.stateId<0)return;
 const observed=bot.blockAt(new Vec3(p.x,p.y,p.z)),props=properties(block);if(!props||!observed||observed.name!==block.name||observed.stateId!==block.stateId)return;
 const r={world_id:a.worldId,principal:a.principal,dimension:d,position:{x:p.x,y:p.y,z:p.z},material:block.name,state_id:block.stateId,properties:props,at:a.now(),source:'bot_block_placed',...(witness.restore&&{restore:structuredClone(witness.restore)})};
 const kept=a.world.known.mutationReceipts;kept[receiptKey(d,p)]=r;a.awaitingAir.delete(receiptKey(d,p));
 const entries=Object.entries(kept),evicted=entries.length>MAX_RECEIPTS;if(evicted)for(const [k]of entries.filter(([,r])=>!r.restore).sort((x,y)=>x[1].at-y[1].at).slice(0,entries.length-MAX_RECEIPTS))delete kept[k];
 persist(a,evicted||!!r.restore);
}
function queryMutation(bot,operation,position,{projectId,build=false,scopeOnly=false}={}){
 const a=authorities.get(bot);if(!a)return {allowed:true,source:'upstream',reason:'shared_world_policy_not_installed'};
 if(!active(a,bot))return {allowed:false,reason:'mutation_authority_session_closed'};
 const p=position&&{x:position.x,y:position.y,z:position.z},d=dimension(bot.game?.dimension);
 if(!OPERATIONS.includes(operation)||!point(p)||!dimensionOK(d))return {allowed:false,reason:'invalid_mutation_scope'};
 const block=bot.blockAt(new Vec3(p.x,p.y,p.z));if(!block&&!(build&&scopeOnly))return {allowed:false,reason:'mutation_cell_unloaded'};
 const kept=a.world.known.mutationReceipts,k=receiptKey(d,p);let r=kept[k];
 if(block&&r)r=reconcileReceipt(a,k,block);
 if(operation==='dig'&&block&&(ITEM_STORES.has(block.name)||/_(?:shulker_box|chest)$/.test(block.name))){
  // Breaking a store drops its contents too. Owning its placed block does
  // not prove ownership of items subsequently deposited by someone else.
  const effects=require('./interaction-guard'),cells=effects.containerFootprint?.(bot,new Vec3(p.x,p.y,p.z));
  const explicit=cells?.length&&cells.every(cell=>queryMutation(bot,'container_withdraw',cell,{build,projectId,scopeOnly}).allowed);
  if(!explicit&&!effects.containerDestructionAllowed?.(bot,new Vec3(p.x,p.y,p.z)))return {allowed:false,reason:'container_contents_permission_required'};
 }
 if(!build&&['dig','place'].includes(operation)){
  const claims=reservationsAt(bot,p);
  if(claims.length){
   const exclusive=claims.length===1&&claims[0].role==='air',project=exclusive&&claims[0].project_id;
   if(operation==='dig'&&exclusive&&r&&!r.revoked&&sameBlock(r,block)&&r.restore?.project_id===project)return {allowed:true,source:'temporary_restore',reason:'confirmed_project_temporary_placement',restoration:{...r.restore,source:r.source,placed_at:r.at}};
   const grant=exclusive&&operation==='place'&&air(block)&&matchingGrant(a,operation,p,d,project,{projectOnly:true});
   if(grant&&Object.values(kept).filter(r=>r.restore).length<MAX_RECEIPTS)return {allowed:true,source:'project_temporary',grant_id:grant.id,reason:'authorized_project_desired_air',restore:{project_id:project,expected:'air'}};
   return {allowed:false,reason:exclusive?'project_air_requires_temporary_scope_or_own_restore':'registered_structure_reserved',reservations:claims};
  }
 }
 const g=matchingGrant(a,operation,p,d,build?projectId:undefined);
 if(g)return {allowed:true,source:g.project_id?'project_grant':'standing_grant',grant_id:g.id,reason:'trusted_scope'};
 if(build)return {allowed:false,reason:'build_requires_trusted_scope'};
 if(!['dig','place'].includes(operation))return {allowed:false,reason:`${operation}_requires_standing_grant`};
 if(r&&!r.revoked&&operation==='dig')return {allowed:true,source:'own_placement',reason:'confirmed_own_placement'};
 if(operation==='place'&&a.policy.temporary_empty_placement&&air(block))return {allowed:true,source:'temporary_empty',reason:'standing_temporary_empty_permission'};
 return {allowed:false,reason:operation==='dig'?'dig_requires_standing_grant_or_own_placement':'place_requires_standing_grant_or_actual_empty_cell'};
}
function confirmedPlacement(bot,position){
 const a=authorities.get(bot),p=position&&{x:position.x,y:position.y,z:position.z};if(!active(a,bot)||!point(p))return null;
 const k=receiptKey(dimension(bot.game?.dimension),p),r=a.world.known.mutationReceipts[k];if(!r)return null;
 const block=bot.blockAt(new Vec3(p.x,p.y,p.z));if(!block)return null;
 const current=reconcileReceipt(a,k,block);
 return current&&!current.revoked&&sameBlock(current,block)?structuredClone(current):null;
}
function mutationStarted(bot,operation,cells){const a=authorities.get(bot);if(!active(a,bot)||operation!=='dig')return;for(const p of cells){const k=receiptKey(dimension(bot.game?.dimension),p);if(a.world.known.mutationReceipts[k]?.restore)a.awaitingAir.add(k);}}
// Observation stays factual; callers separately expose only usable resources.
// The bounded denial is context for a decision, never a permission request.
function filterMutationCells(bot,operation,positions,{source,onBlocked}={}){
 const allowed=[];let denied=null;
 for(const p of positions){const result=queryMutation(bot,operation,p);if(result.allowed)allowed.push(p);else if(!denied)denied={source,operation,reason:result.reason,position:{x:p.x,y:p.y,z:p.z}};}
 if(denied)onBlocked?.({...denied,known_candidates:positions.length,permitted_candidates:allowed.length});
 return allowed;
}
function mutationAuthoritySummary(bot){
 const a=authorities.get(bot);if(!a)return {enabled:false};
 const extent=cells=>({min:Object.fromEntries(['x','y','z'].map(k=>[k,Math.min(...cells.map(p=>p[k]))])),max:Object.fromEntries(['x','y','z'].map(k=>[k,Math.max(...cells.map(p=>p[k]))]))});
 const pending=pendingRestorations(bot);
 return {pending_restorations:pending.slice(0,16).map(r=>({project_id:r.restore.project_id,position:r.position,material:r.material,expected:'air',ownership_revoked:!!r.revoked})),omitted_restorations:Math.max(0,pending.length-16),enabled:true,active:active(a,bot),world_id:a.worldId,principal:a.principal,temporary_empty_placement:a.policy.temporary_empty_placement,
  scopes:a.policy.grants.slice(0,16).map(g=>({id:g.id,dimension:g.dimension,operations:g.operations,project_id:g.project_id||null,...(g.cells?{cell_count:g.cells.length,bounds:extent(g.cells),bounds_note:'Descriptive extent only; exact cell membership is still required.'}:{area:g.area}),expires_at:g.expires_at??null})),
  omitted_scopes:Math.max(0,a.policy.grants.length-16),unknown_dig:'Requires a standing scope or confirmed own placement; appearance and unprotected status do not prove permission.',
  unsupported_effects:['fluid bucket use','reference-merging placement','other item-on-block effects such as cauldron filling, tilling, keys, eyes and ignition'],
  scope:'Scoped block edits and explicitly granted effects only; not proof of land ownership or all interaction/physics side effects.'};
}
function blockInteractionSupport(bot,blockName,itemName){
 if(!authorities.has(bot))return {allowed:true,emptyHand:false};
 // Ordinary navigation and opening a UI have a known empty-hand operation.
 // Other equipped-item uses must not be silently changed into that operation.
 const ui=['crafting_table','furnace','blast_furnace','smoker','chest','trapped_chest','ender_chest','barrel','hopper','dispenser','dropper','brewing_stand','enchanting_table','anvil','chipped_anvil','damaged_anvil','grindstone','stonecutter','cartography_table','smithing_table','loom','beacon'];
 const ordinary=/_(door|trapdoor|fence_gate|shulker_box|chest)$/.test(blockName||'')||blockName==='shulker_box'||ui.includes(blockName)||blockName==='bell'||/_bed$/.test(blockName||'')&&dimension(bot.game?.dimension)==='overworld';
 return ordinary?{allowed:true,emptyHand:true}:{allowed:false,reason:itemName?'unsupported_item_block_effect':'unsupported_block_interaction'};
}
function hasStandingBuildScope(bot){
 const a=authorities.get(bot);if(!a)return true;
 return active(a,bot)&&a.grants.some(({value:g})=>!g.project_id&&g.dimension===dimension(bot.game?.dimension)&&g.operations.includes('place')&&(g.expires_at===undefined||g.expires_at>a.now()));
}
module.exports={loadMutationAuthority,validateMutationAuthority,installMutationAuthority,queryMutation,mutationStarted,confirmedPlacement,pendingRestorations,reservationsAt,blockInteractionSupport,filterMutationCells,noteConfirmedPlacement,mutationAuthoritySummary,hasStandingBuildScope,hasMutationAuthority:bot=>authorities.has(bot),mutationAuthorityCurrent:bot=>!authorities.has(bot)||active(authorities.get(bot),bot)};
