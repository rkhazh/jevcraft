'use strict';
// Exact local edit batches. The ordinary work scheduler owns survival and leases.
const {Vec3}=require('vec3'),{exact}=require('./persona-admission');
const {dependenciesMatch}=require('./persona-actions');
const AIR=new Set(['air','cave_air','void_air']);
const SOIL=new Set(['grass_block','podzol','mycelium']);
const simpleProperties=s=>Object.entries(s.properties).every(([k,v])=>SOIL.has(s.name)&&k==='snowy'&&typeof v==='boolean');
const key=p=>`${p.x},${p.y},${p.z}`;
const point=p=>exact(p,['x','y','z'])&&[p.x,p.y,p.z].every(Number.isInteger)&&Math.abs(p.x)<=29999984&&Math.abs(p.z)<=29999984&&p.y>=-64&&p.y<=319;
const blocked=reason=>Object.assign(Error(reason),{name:'Blocked',personaEditTerminal:true,code:reason==='edit authority denied'?'authority_denied':reason.includes('unsupported')?'capability_unsupported':reason.includes('unloaded')?'temporarily_unavailable':reason.includes('changed')?'target_unresolved':'prerequisite_missing'});
const state=b=>b?{name:b.name,state_id:b.stateId,properties:b.getProperties?.()||{}}:null;
const same=(b,s)=>!!b&&b.name===s.name&&b.stateId===s.state_id&&dependenciesMatch(b.getProperties?.()||{},s.properties);
const desired=(b,s)=>!!b&&(s.name==='air'?AIR.has(b.name):b.name===s.name&&dependenciesMatch(b.getProperties?.()||{},s.properties));
function validState(s,expected){return exact(s,expected?['name','state_id','properties']:['name','properties'])&&typeof s.name==='string'&&/^[a-z0-9_]{1,128}$/.test(s.name)&&(!expected||Number.isInteger(s.state_id)&&s.state_id>=0)&&s.properties&&typeof s.properties==='object'&&!Array.isArray(s.properties)&&Object.keys(s.properties).length<=24;}
function validateEdit(spec,snapshot){
 if(!exact(spec,['kind','dimension','cells','preserve','source_task_id'])||spec.kind!=='edit'||spec.dimension!==String(snapshot.dimension).replace(/^minecraft:/,'')||!['overworld','the_nether','the_end'].includes(spec.dimension)||!(spec.source_task_id===null||typeof spec.source_task_id==='string'&&spec.source_task_id.length<=128)||!Array.isArray(spec.cells)||!spec.cells.length||spec.cells.length>64||!Array.isArray(spec.preserve)||spec.preserve.length>64)throw blocked('unsupported edit spec');
 const ids=new Set();for(const cell of [...spec.cells,...spec.preserve]){
  const preserve=spec.preserve.includes(cell);
  if(!exact(cell,preserve?['position','expected']:['position','expected','desired'])||!point(cell.position)||!validState(cell.expected,true)||!preserve&&!validState(cell.desired,false)||ids.has(key(cell.position))||!snapshot.position||Math.hypot(cell.position.x-snapshot.position.x,cell.position.y-snapshot.position.y,cell.position.z-snapshot.position.z)>16)throw blocked('invalid edit cell');
  ids.add(key(cell.position));
 }
 return structuredClone(spec);
}
function verifyEdit(bot,goal){
 const observed=[],unknown=[],remaining=[];
 if(String(bot.game?.dimension).replace(/^minecraft:/,'')!==goal.dimension)return {verified:false,observed,unknown:goal.cells.map(c=>c.position),remaining};
 for(const c of goal.cells){const b=bot.blockAt(new Vec3(c.position.x,c.position.y,c.position.z));if(!b)unknown.push(c.position);else{observed.push({position:c.position,state:state(b)});if(!desired(b,c.desired))remaining.push(c.position);}}
 for(const c of goal.preserve){const b=bot.blockAt(new Vec3(c.position.x,c.position.y,c.position.z));if(!b)unknown.push(c.position);else if(!same(b,c.expected))remaining.push(c.position);}
 return {verified:unknown.length===0&&remaining.length===0,observed,unknown,remaining};
}
function simple(bot,name){
 if(AIR.has(name))return true;
 const block=bot.registry?.blocksByName?.[name];
 return !!block&&block.diggable!==false&&block.boundingBox==='block'&&!block.drops?.some(d=>typeof d==='object')&&!require('./skills').opensOnClick(name)&&!/(sand|gravel|concrete_powder|anvil|bed|door|piston|observer|redstone|water|lava|ice|snow|leaves|log|wood|stem|hyphae|sponge|tnt|coral|sculk|command|structure|jigsaw|spawner|portal|infested|silverfish|bee_nest|beehive)/.test(name)&&(!(block.states||[]).length||SOIL.has(name)&&(block.states||[]).every(s=>s.name==='snowy'));
}
function assertCurrent(bot,goal,c,authorize){
 if(String(bot.game?.dimension).replace(/^minecraft:/,'')!==goal.dimension)throw blocked('edit dimension changed');
 const b=bot.blockAt(new Vec3(c.position.x,c.position.y,c.position.z));
 if(!b)throw blocked('edit target unloaded');
 if(!same(b,c.expected)&&!desired(b,c.desired)&&!(goal.editProgress?.[key(c.position)]?.intermediate&&same(b,goal.editProgress[key(c.position)].intermediate)))throw blocked('edit target changed');
 if(bot._registeredStructureProtection?.(c.position))throw blocked('registered structure requires existing build edit');
 for(const p of goal.preserve){if(!same(bot.blockAt(new Vec3(p.position.x,p.position.y,p.position.z)),p.expected))throw blocked('preserve cell changed');}
 const operation=AIR.has(b.name)?'place':'dig';
 if(!authorize(operation,c.position))throw blocked('edit authority denied');
 return b;
}
async function executeEdit(bot,goal,{task,save,authorize=(operation,p)=>require('./mutation-authority').queryMutation(bot,operation,new Vec3(p.x,p.y,p.z)).allowed}){
 task.check();validateEdit({kind:'edit',dimension:goal.dimension,cells:goal.cells,preserve:goal.preserve,source_task_id:goal.source_task_id},{dimension:bot.game?.dimension,position:bot.entity?.position});
 goal.editProgress||={};const report=verifyEdit(bot,goal);goal.editVerification=report;if(report.verified)return true;
 const c=goal.cells.find(c=>!desired(bot.blockAt(new Vec3(c.position.x,c.position.y,c.position.z)),c.desired));
 if(!c)throw blocked('preserve cell changed or edit target unloaded');
 const p=new Vec3(c.position.x,c.position.y,c.position.z),b=assertCurrent(bot,goal,c,authorize);
 if(!simple(bot,b.name)||!simple(bot,c.desired.name)||!simpleProperties(c.expected)||!simpleProperties(c.desired))throw blocked('unsupported interactive or stateful edit block');
 if(Math.hypot(p.x+.5-bot.entity.position.x,p.y+.5-(bot.entity.position.y+1.62),p.z+.5-bot.entity.position.z)>4.5)throw blocked('edit target needs closer permitted viewpoint');
 if(!AIR.has(b.name)){
  // A dig must not trigger unmodelled attached/flowing/gravity effects.
  for(const d of [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){const n=bot.blockAt(p.offset(...d));if(!n||!simple(bot,n.name))throw blocked('unsupported edit neighbor effect');}
  await require('./structure-mutations').withMutationExpectation(bot,{operation:'dig',position:c.position,name:b.name,stateId:b.stateId,check:()=>{task.check();assertCurrent(bot,goal,c,authorize);}},()=>require('./skills').digWithTool(bot,b,true));
  const after=bot.blockAt(p);if(!after||!AIR.has(after.name))throw blocked('edit dig not observed');
  goal.editProgress[key(p)]={intermediate:state(after)};save();
 }else{
  const progress=goal.editProgress[key(p)];
  if(!same(b,c.expected)&&(!progress?.intermediate||!same(b,progress.intermediate)))throw blocked('edit intermediate changed');
  const item=bot.inventory.items().find(i=>i.name===c.desired.name);if(!item)throw blocked('edit material unavailable');
  const faces=[[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
  const face=faces.find(d=>{const ref=bot.blockAt(p.offset(-d[0],-d[1],-d[2]));return ref?.boundingBox==='block'&&simple(bot,ref.name);});if(!face)throw blocked('edit placement needs existing support');
  await bot.equip(item,'hand');task.check();assertCurrent(bot,goal,c,authorize);
  await require('./structure-mutations').withMutationExpectation(bot,{operation:'place',position:c.position,name:b.name,stateId:b.stateId,check:()=>{task.check();assertCurrent(bot,goal,c,authorize);}},()=>bot.placeBlock(bot.blockAt(p.offset(-face[0],-face[1],-face[2])),new Vec3(...face)));
 }
 if(desired(bot.blockAt(p),c.desired)){goal.editProgress[key(p)]={complete:true,state:state(bot.blockAt(p))};save();}
 goal.editVerification=verifyEdit(bot,goal);save();return goal.editVerification.verified;
}
function checkEdit(bot,spec,progress={}){validateEdit(spec,{dimension:bot.game?.dimension,position:bot.entity?.position});for(const c of spec.cells){if(!simple(bot,c.expected.name)||!simple(bot,c.desired.name))throw blocked('unsupported edit block');if(bot._registeredStructureProtection?.(c.position))throw blocked('unsupported registered structure edit');const current=bot.blockAt(new Vec3(c.position.x,c.position.y,c.position.z)),saved=progress[key(c.position)];if(!same(current,c.expected)&&!(saved?.intermediate&&same(current,saved.intermediate))&&!(saved?.complete&&desired(current,c.desired)))throw blocked('edit target changed');for(const operation of [!AIR.has(c.expected.name)&&'dig',!AIR.has(c.desired.name)&&'place'].filter(Boolean))if(!require('./mutation-authority').queryMutation(bot,operation,new Vec3(c.position.x,c.position.y,c.position.z)).allowed)throw blocked('edit authority denied');}return true;}
module.exports={validateEdit,executeEdit,verifyEdit,checkEdit};
