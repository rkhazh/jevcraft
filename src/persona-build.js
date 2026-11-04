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
 let design;
 try{design=validateSchematic(source,registry);}catch(err){
  if(typeof err.message==='string'&&err.message.startsWith('Invalid building schematic:'))err.validationDetail=err.message.replace(/[\p{Cc}\p{Cf}]/gu,' ').slice(0,240);
  throw err;
 }
 if(design.blocks.length>LIMITS.max_blocks)fail('too many blocks');
 return {...design,backend:'persona-validated',createdAt:new Date().toISOString()};
}
function siteBinding(value) {
 if(value==null)return null;
 const p=value.position;
 if(Object.keys(value).sort().join()!=='dimension,position,radius'||value.dimension!=='overworld'||!p||Object.keys(p).sort().join()!=='x,y,z'||![p.x,p.y,p.z].every(Number.isFinite)||Math.abs(p.x)>29999984||Math.abs(p.z)>29999984||p.y< -64||p.y>319||!Number.isFinite(value.radius)||value.radius<1||value.radius>32)throw Object.assign(new Error('Invalid requested build site'),{code:'invalid_build_site'});
 return structuredClone(value);
}
function siteCenter(origin,size) {
 if(!origin)return null;
 return {x:origin.x+(Number.isFinite(size?.[0])?Math.floor(size[0]/2):0),y:origin.y,z:origin.z+(Number.isFinite(size?.[2])?Math.floor(size[2]/2):0)};
}
function siteAllowed(binding,origin,size,dim='overworld') {
 if(!binding)return true;
 const center=siteCenter(origin,size);
 return dimension(dim)===binding.dimension&&!!center&&Math.abs(center.y-binding.position.y)<=4&&Math.hypot(center.x-binding.position.x,center.z-binding.position.z)<=binding.radius;
}
function assertSite(binding,origin,dim,size) {
 if(!siteAllowed(binding,origin,size,dim))throw Object.assign(new Error('Structure is outside the requested build site'),{code:'build_site_mismatch'});
}
function prepareBuild(bot,spec,principal,{enabled=false}={}) {
 if(!enabled)fail('building disabled');
 const here={...bot.entity.position}, binding=siteBinding(spec.site_binding);
 if(binding&&dimension(bot.game?.dimension)!==binding.dimension)throw Object.assign(new Error('Requested build site is in another dimension'),{code:'build_site_mismatch'});
 const anchor=binding?{...binding.position}:here;
 if(Math.hypot(anchor.x-here.x,anchor.y-here.y,anchor.z-here.z)>1024)fail('structure out of reach');
 const base={personaBuildPolicy:{anchor,site_binding:binding},suspendedTasks:[]};
 if(binding&&spec.mode==='fresh'){base.buildAnchor={...anchor};if(Math.hypot(anchor.x-here.x,anchor.y-here.y,anchor.z-here.z)>8)base.personaBuildReturn={target:{...anchor},entryId:null};}
 const entry=spec.build_id?bot.buildRegistry?.find(spec.build_id):null;
 if(spec.mode!=='fresh') {
  if(!entry||entry.from!==principal||dimension(entry.dimension)!==dimension(bot.game?.dimension))fail('unknown or unowned structure');
  assertSite(binding,entry.origin,entry.dimension,entry.design?.source?.size);
  const distance=Math.hypot(entry.origin.x-here.x,entry.origin.y-here.y,entry.origin.z-here.z);
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
function unchangedOriginalFoundation(bp,cell,block) {
 const key=`${cell.x},${cell.y},${cell.z}`;
 if(!Number.isFinite(bp.origin?.y)||cell.y>bp.origin.y||Object.keys(cell.properties||{}).length||/_bed$|_door$/.test(cell.material))return false;
 if(!block||! /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|stone|deepslate|granite|diorite|andesite|tuff|sandstone|red_sandstone|terracotta)$/.test(block.name))return false;
 if(bp.initialNames?.[key]!==block.name||bp.initialBlocks?.[key]===undefined||bp.initialBlocks[key] !== (block.stateId??block.name))return false;
 return true;
}
function retainedOriginalFoundation(bot,bp,cell,block) {
 if(!unchangedOriginalFoundation(bp,cell,block))return false;
 const origin=new Vec3(cell.x,cell.y,cell.z);
 return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].every(([x,y,z])=>bot.blockAt(origin.offset(x,y,z))?.boundingBox==='block');
}
function verifiedEditOwnership(bot,entry) {
 const owned=new Set();
 for(const cell of entry?.blueprint?.blocks||[]) {
  const key=`${cell.x},${cell.y},${cell.z}`,block=bot.blockAt(new Vec3(cell.x,cell.y,cell.z));
  if(!block)fail('edit needs loaded structure blocks');
  if(['air','cave_air','void_air'].includes(block.name))continue;
  // An approach may expose original terrain. It is still original ground,
  // not another builder's replacement; enclosure belongs only to completion.
  if(unchangedOriginalFoundation(entry.blueprint,cell,block))continue;
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
 assertSite(goal.personaBuildPolicy.site_binding,bp.origin,goal.personaBuildPolicy.site_binding?.dimension,goal.design?.source?.size);
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
function designAdaptation(blueprint) {
 // Verification covers the selected, terrain-adjusted blueprint. Its source
 // schematic can still contain requested cells omitted to preserve others.
 // Older selectors omitted `preserved` on zero; absence cannot prove zero.
 const result={scope:'selected_blueprint_preservation',status:'unknown',preserved_cell_count:null,preserved_cells:[]};
 const cells=blueprint?.preserved;
 if(!Array.isArray(cells)||cells.length>14000||!cells.every(p=>p&&['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000)))return result;
 return {...result,status:'recorded',preserved_cell_count:cells.length,preserved_cells:cells.slice(0,5).map(({x,y,z})=>({x,y,z}))};
}
function describeBuilds(bot) {
 const entries=(bot.buildRegistry?.all(bot.game?.dimension)||[]).filter(e=>e.from?.startsWith('persona:')).slice(-4).reverse();
 // Bound aggregate world reads: footprint expansion is at most two cells and
 // retained natural foundation checks at most six neighbours per cell.
 let readBudget=4096;
 return entries.map((entry,index)=>{
  const cost=(entry.blueprint?.blocks?.length||0)*16+(entry.blueprint?.empty?.length||0);
  const checked=cost>0&&cost<=readBudget;
  const verification=checked?buildVerification(bot,{blueprint:entry.blueprint}):null;
  if(checked)readBudget-=cost;
  return {id:entry.id,name:entry.name,status:entry.status==='complete'&&!entry.personaVerifiedAt?'complete_unverified':entry.status,status_scope:'historical',
   design_adaptation:designAdaptation(entry.blueprint),
   verified:verification?.verified===true,verification,verification_scope:checked?'current_loaded_world':'not_checked_budget',
   last_verified_at:entry.personaVerifiedAt||null,last_verification:entry.personaVerification||null,
   origin:entry.origin,site_center:siteCenter(entry.origin,entry.design?.source?.size),bounds:entry.bounds,
   distance:bot.entity?.position&&entry.origin?Math.round(Math.hypot(entry.origin.x-bot.entity.position.x,entry.origin.y-bot.entity.position.y,entry.origin.z-bot.entity.position.z)):null,
   block_count:entry.blueprint?.blocks?.length||0,...(index===0&&entry.design?.source&&Buffer.byteLength(JSON.stringify(entry.design.source))<=24000?{schematic:entry.design.source}:{}),
  };
 });
}
module.exports={siteAllowed,siteCenter,LIMITS,prepareBuild,assertBuildPolicy,verifyBuild,capabilities,describeBuilds,verifiedEditOwnership,buildVerification};
