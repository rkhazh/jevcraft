'use strict';
const {Vec3}=require('vec3');
const {validateSchematic,buildPalette}=require('./designer');
const {matchesBuildBlock,buildFootprint,matchesOwnership}=require('./build-blocks');
const LIMITS=Object.freeze({max_blocks:1024,max_size:[24,16,24],max_regions:64});
const dimension=value=>String(value||'').replace(/^minecraft:/,'');
function fail(message){const code=({'building disabled':'building_disabled','unknown or unowned structure':'build_not_owned','structure out of reach':'build_out_of_range','structure changed by another builder':'build_structure_changed','edit needs loaded structure blocks':'build_chunks_unloaded'})[message]||'build_policy_rejected';throw Object.assign(new Error(`Persona build: ${message}`),{name:'PersonaBuildPolicy',code});}
function validate(source,registry) {
 if(!source||Object.keys(source).sort().join()!==['name','description','size','palette','regions','entrance','existingOffset','site'].sort().join()||!Array.isArray(source.size)||source.size.some((n,i)=>n>LIMITS.max_size[i])||!Array.isArray(source.regions)||source.regions.length>LIMITS.max_regions||source.site!==null)fail('schematic exceeds policy');
 if(Buffer.byteLength(JSON.stringify(source))>24000)fail('schematic too large');
 const design=validateSchematic(source,registry);
 if(design.blocks.length>LIMITS.max_blocks)fail('too many blocks');
 return {...design,backend:'persona-validated',createdAt:new Date().toISOString()};
}
function prepareBuild(bot,spec,principal,{enabled=false}={}) {
 if(!enabled)fail('building disabled');
 const anchor={...bot.entity.position};
 const base={personaBuildPolicy:{anchor},suspendedTasks:[]};
 const entry=spec.build_id?bot.buildRegistry?.find(spec.build_id):null;
 if(spec.mode!=='fresh') {
  if(!entry||entry.from!==principal||dimension(entry.dimension)!==dimension(bot.game?.dimension))fail('unknown or unowned structure');
  const distance=Math.hypot(entry.origin.x-anchor.x,entry.origin.y-anchor.y,entry.origin.z-anchor.z);
  if(distance>1024)fail('structure out of reach');
  base.personaBuildPolicy.anchor={...entry.origin};
  if(distance>8)base.personaBuildReturn={target:{...(entry.entrance||entry.origin)},entryId:entry.id};
 }
 if(['finish','repair'].includes(spec.mode)){
  if(spec.schematic!==null||!entry?.design?.source)fail('continuation needs saved design');
  const design=validate(entry.design.source,bot.registry);
  assertBuildPolicy({...base,design,blueprint:entry.blueprint});
  return {...base,buildOwned:structuredClone(entry.buildOwned||{}),continueBuild:{id:entry.id,mode:spec.mode}};
 }
 if(!['fresh','edit'].includes(spec.mode))fail('unsupported mode');
 const design=validate(spec.schematic,bot.registry);
 if(spec.mode==='fresh'){
  if(spec.build_id!==null||design.existingOffset!==null)fail('fresh structure cannot replace existing work');
  return {...base,design};
 }
 if(!design.existingOffset)fail('edit must align existing structure');
 if(!base.personaBuildReturn)verifiedEditOwnership(bot,entry);
 return {...base,design,buildId:entry.id,buildAnchor:{...entry.origin},buildContinuation:{mode:'edit',target:entry.id,name:entry.name,placement:'beside_target'}};
}
// Retention is evidence of unchanged original terrain, never permission to
// substitute an arbitrary block or to skip visible/oriented construction.
function retainedOriginalFoundation(bot,bp,cell,block) {
 const key=`${cell.x},${cell.y},${cell.z}`;
 if(!Number.isFinite(bp.origin?.y)||cell.y>bp.origin.y||Object.keys(cell.properties||{}).length||/_bed$|_door$/.test(cell.material))return false;
 if(!block||! /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|stone|deepslate|granite|diorite|andesite|tuff|sandstone|red_sandstone|terracotta)$/.test(block.name))return false;
 if(bp.initialNames?.[key]!==block.name||bp.initialBlocks?.[key]===undefined||bp.initialBlocks[key] !== (block.stateId??block.name))return false;
 const origin=new Vec3(cell.x,cell.y,cell.z);
 return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].every(([x,y,z])=>bot.blockAt(origin.offset(x,y,z))?.boundingBox==='block');
}
function verifiedEditOwnership(bot,entry) {
 const owned=new Set();
 for(const cell of entry?.blueprint?.blocks||[]) {
  const key=`${cell.x},${cell.y},${cell.z}`,block=bot.blockAt(new Vec3(cell.x,cell.y,cell.z));
  if(!block)fail('edit needs loaded structure blocks');
  if(['air','cave_air','void_air'].includes(block.name))continue;
  if(retainedOriginalFoundation(bot,entry.blueprint,cell,block))continue;
  if(!matchesBuildBlock(block,cell)&&!matchesOwnership(block,entry.buildOwned?.[key]))fail('structure changed by another builder');
  owned.add(key);
 }
 return owned;
}
function assertBuildPolicy(goal) {
 if(!goal.personaBuildPolicy)return;
 const source=goal.design?.source;
 if(source&&(source.size.some((n,i)=>n>LIMITS.max_size[i])||source.regions.length>LIMITS.max_regions))fail('design exceeds policy');
 const bp=goal.blueprint;if(!bp)return;
 if(!Array.isArray(bp.blocks)||bp.blocks.length>LIMITS.max_blocks)fail('placed geometry exceeds policy');
 const clear=bp.terrain?.clear||[],fill=bp.terrain?.fill||[];
 if(clear.length+fill.length>2048)fail('earthworks exceed policy');
 const cells=[...bp.blocks,...(bp.empty||[]),...clear,...fill],anchor=goal.personaBuildPolicy.anchor;
 if(cells.length>14000||cells.some(p=>![p.x,p.y,p.z].every(Number.isFinite)||Math.hypot(p.x-anchor.x,p.y-anchor.y,p.z-anchor.z)>64))fail('site exceeds admitted radius');
}
function buildVerification(bot,goal) {
 const report={verified:false,exact_material_match:false,matched_blocks:0,retained_blocks:0,retained_enclosed_natural:[],mismatched_blocks:0,unknown_blocks:0,blocked_empty:0,samples:[]};
 try{
  assertBuildPolicy(goal);const bp=goal.blueprint;if(!bp?.blocks?.length||bp.blocks.length>LIMITS.max_blocks)return report;
  const sample=(p,expected,observed)=>{if(report.samples.length<5)report.samples.push({position:{x:p.x,y:p.y,z:p.z},expected,observed});};
  const cells=[...new Map(bp.blocks.flatMap(buildFootprint).map(cell=>[`${cell.x},${cell.y},${cell.z}`,cell])).values()];
  for(const cell of cells){
   const block=bot.blockAt(new Vec3(cell.x,cell.y,cell.z));
   if(!block){report.unknown_blocks++;sample(cell,cell.material,'unloaded');}
   else if(matchesBuildBlock(block,cell))report.matched_blocks++;
   else if(retainedOriginalFoundation(bot,bp,cell,block)){report.retained_blocks++;if(report.retained_enclosed_natural.length<8)report.retained_enclosed_natural.push({position:{x:cell.x,y:cell.y,z:cell.z},requested:cell.material,observed:block.name});}
   else{report.mismatched_blocks++;sample(cell,cell.material,String(block.name).slice(0,64));}
  }
  for(const p of bp.empty||[]){const block=bot.blockAt(new Vec3(p.x,p.y,p.z));
   if(!block){report.unknown_blocks++;sample(p,'air','unloaded');}
   else if(!['air','cave_air','void_air'].includes(block.name)){report.blocked_empty++;sample(p,'air',String(block.name).slice(0,64));}
  }
  report.verified=!report.mismatched_blocks&&!report.unknown_blocks&&!report.blocked_empty;
  report.exact_material_match=report.verified&&report.retained_blocks===0;
 }catch(_){report.policy_error=true;}
 return report;
}
function verifyBuild(bot,goal){return buildVerification(bot,goal).verified;}
function capabilities(bot,enabled){return {...LIMITS,enabled,modes:enabled?['fresh','finish','repair','edit']:[],allowed_blocks:enabled&&bot.registry?.blocksArray?buildPalette(bot.registry).slice(0,512):[]};}
function describeBuilds(bot) {
 const entries=(bot.buildRegistry?.all(bot.game?.dimension)||[]).filter(e=>e.from?.startsWith('persona:')).slice(-4).reverse();
 return entries.map((entry,index)=>({id:entry.id,name:entry.name,status:entry.status==='complete'&&!entry.personaVerifiedAt?'complete_unverified':entry.status,verified:entry.status==='complete'&&!!entry.personaVerifiedAt,verification:entry.personaVerification||null,origin:entry.origin,bounds:entry.bounds,
  distance:bot.entity?.position&&entry.origin?Math.round(Math.hypot(entry.origin.x-bot.entity.position.x,entry.origin.y-bot.entity.position.y,entry.origin.z-bot.entity.position.z)):null,
  block_count:entry.blueprint?.blocks?.length||0,...(index===0&&entry.design?.source&&Buffer.byteLength(JSON.stringify(entry.design.source))<=24000?{schematic:entry.design.source}:{}),
 }));
}
module.exports={LIMITS,prepareBuild,assertBuildPolicy,verifyBuild,capabilities,describeBuilds,verifiedEditOwnership,buildVerification};
