'use strict';
const {Vec3}=require('vec3');
const {validateSchematic,buildPalette}=require('./designer');
const {matchesBuildBlock,buildFootprint}=require('./build-blocks');
const LIMITS=Object.freeze({max_blocks:1024,max_size:[24,16,24],max_regions:64});
const dimension=value=>String(value||'').replace(/^minecraft:/,'');
function fail(message){throw Object.assign(new Error(`Persona build: ${message}`),{name:'PersonaBuildPolicy'});}
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
  if(Math.hypot(entry.origin.x-anchor.x,entry.origin.y-anchor.y,entry.origin.z-anchor.z)>64)fail('structure out of reach');
 }
 if(['finish','repair'].includes(spec.mode)){
  if(spec.schematic!==null||!entry?.design?.source)fail('continuation needs saved design');
  const design=validate(entry.design.source,bot.registry);
  assertBuildPolicy({...base,design,blueprint:entry.blueprint});
  return {...base,continueBuild:{id:entry.id,mode:spec.mode}};
 }
 if(!['fresh','edit'].includes(spec.mode))fail('unsupported mode');
 const design=validate(spec.schematic,bot.registry);
 if(spec.mode==='fresh'){
  if(spec.build_id!==null||design.existingOffset!==null)fail('fresh structure cannot replace existing work');
  return {...base,design};
 }
 if(!design.existingOffset)fail('edit must align existing structure');
 return {...base,design,buildId:entry.id,buildAnchor:{...entry.origin},buildContinuation:{mode:'edit',target:entry.id,name:entry.name,placement:'beside_target'}};
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
function verifyBuild(bot,goal) {
 try{
  assertBuildPolicy(goal);const bp=goal.blueprint;if(!bp?.blocks?.length||bp.blocks.length>LIMITS.max_blocks)return false;
  const block=p=>bot.blockAt(new Vec3(p.x,p.y,p.z));
  return bp.blocks.every(cell=>buildFootprint(cell).every(part=>matchesBuildBlock(block(part),part)))&&
   (bp.empty||[]).every(p=>['air','cave_air','void_air'].includes(block(p)?.name));
 }catch(_){return false;}
}
function capabilities(bot,enabled){return {...LIMITS,enabled,modes:enabled?['fresh','finish','repair','edit']:[],allowed_blocks:enabled&&bot.registry?.blocksArray?buildPalette(bot.registry).slice(0,512):[]};}
function describeBuilds(bot) {
 const entries=(bot.buildRegistry?.all(bot.game?.dimension)||[]).filter(e=>e.from?.startsWith('persona:')).slice(-4).reverse();
 return entries.map((entry,index)=>({id:entry.id,name:entry.name,status:entry.status==='complete'&&!entry.personaVerifiedAt?'complete_unverified':entry.status,verified:entry.status==='complete'&&!!entry.personaVerifiedAt,origin:entry.origin,bounds:entry.bounds,
  distance:bot.entity?.position&&entry.origin?Math.round(Math.hypot(entry.origin.x-bot.entity.position.x,entry.origin.y-bot.entity.position.y,entry.origin.z-bot.entity.position.z)):null,
  block_count:entry.blueprint?.blocks?.length||0,...(index===0&&entry.design?.source&&Buffer.byteLength(JSON.stringify(entry.design.source))<=24000?{schematic:entry.design.source}:{}),
 }));
}
module.exports={LIMITS,prepareBuild,assertBuildPolicy,verifyBuild,capabilities,describeBuilds};
