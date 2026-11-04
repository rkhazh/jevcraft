'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareBuild,verifyBuild,assertBuildPolicy,describeBuilds}=require('../src/persona-build');
const registry=require('minecraft-data')('1.21.4');
const schematic=()=>({name:'A model design',description:'A floor',size:[3,2,3],palette:['oak_planks'],regions:[{from:[0,0,0],to:[2,0,2],block:'oak_planks',properties:null}],entrance:null,existingOffset:null,site:null});
function fixture(){const entries=[];return {entries,bot:{registry,entity:{position:{x:0,y:65,z:0}},game:{dimension:'overworld'},buildRegistry:{find:id=>entries.find(e=>e.id===id),all:()=>entries},blockAt:()=>({name:'oak_planks'})}};}
test('model-authored geometry is validated in Survival without a template or designer call',()=>{
 const {bot}=fixture();const goal=prepareBuild(bot,{kind:'build',request:'Make a floor',mode:'fresh',build_id:null,schematic:schematic()},'persona:p',{enabled:true});
 assert.equal(goal.design.source.name,'A model design');assert.equal(goal.design.blocks.length,9);assert.equal(goal.design.backend,'persona-validated');
 assert.throws(()=>prepareBuild(bot,{mode:'fresh',schematic:{...schematic(),size:[25,2,3]}},'persona:p',{enabled:true}));
 assert.throws(()=>prepareBuild(bot,{mode:'fresh',schematic:schematic()},'persona:p',{enabled:false}));
});
test('continuation requires owned world structure and an edit schematic aligned to it',()=>{
 const {bot,entries}=fixture();entries.push({id:'b',from:'persona:p',dimension:'overworld',origin:{x:0,y:65,z:0},blueprint:{blocks:[],bounds:{min:{x:0,y:65,z:0},max:{x:2,y:66,z:2}}},design:{source:schematic()}});
 assert.equal(prepareBuild(bot,{mode:'finish',build_id:'b',schematic:null},'persona:p',{enabled:true}).continueBuild.id,'b');
 assert.throws(()=>prepareBuild(bot,{mode:'finish',build_id:'b',schematic:null},'persona:q',{enabled:true}));
 assert.throws(()=>prepareBuild(bot,{mode:'edit',build_id:'b',schematic:schematic()},'persona:p',{enabled:true}));
 const edited=prepareBuild(bot,{mode:'edit',build_id:'b',schematic:{...schematic(),existingOffset:[0,0,0]}},'persona:p',{enabled:true});assert.equal(edited.buildContinuation.mode,'edit');
});
test('completion verifies every block and empty cell; policy refuses oversized terrain before mutations',()=>{
 const {bot}=fixture();const goal={personaBuildPolicy:{anchor:{x:0,y:65,z:0}},blueprint:{blocks:[{x:0,y:65,z:0,material:'oak_planks'}],empty:[{x:0,y:66,z:0}]}};
 bot.blockAt=p=>({name:p.y===65?'oak_planks':'air'});assert.equal(verifyBuild(bot,goal),true);
 bot.blockAt=()=>({name:'air'});assert.equal(verifyBuild(bot,goal),false);
 goal.blueprint.terrain={clear:Array.from({length:2049},()=>({x:0,y:0,z:0})),fill:[]};assert.throws(()=>assertBuildPolicy(goal));
 assert.deepEqual(describeBuilds(bot),[]);
});
test('edits refuse external replacement and continuation retains recorded ownership',()=>{
 const {bot,entries}=fixture();const blueprint={origin:{x:0,y:65,z:0},bounds:{min:{x:0,y:65,z:0},max:{x:2,y:66,z:2}},blocks:[{x:0,y:65,z:0,material:'oak_planks'}],empty:[]};
 entries.push({id:'b',from:'persona:p',dimension:'overworld',origin:blueprint.origin,blueprint,design:{source:schematic()},buildOwned:{'0,65,0':42}});
 bot.blockAt=()=>({name:'diamond_block',stateId:99});
 assert.throws(()=>prepareBuild(bot,{mode:'edit',build_id:'b',schematic:{...schematic(),existingOffset:[0,0,0]}},'persona:p',{enabled:true}));
 const continuing=prepareBuild(bot,{mode:'repair',build_id:'b',schematic:null},'persona:p',{enabled:true});assert.equal(continuing.buildOwned['0,65,0'],42);
});
test('registry persists ownership signatures for later leases',()=>{
 const {BuildRegistry}=require('../src/builds');const registry=new BuildRegistry(null);
 const goal={kind:'build',from:'persona:p',request:'A floor',design:{source:schematic()},buildOwned:{'0,65,0':42},blueprint:{origin:{x:0,y:65,z:0},bounds:{min:{x:0,y:65,z:0},max:{x:2,y:66,z:2}},blocks:[]}};
 const entry=registry.remember(goal,{dimension:'overworld'});assert.equal(entry.buildOwned['0,65,0'],42);goal.buildOwned['0,65,0']=99;assert.equal(entry.buildOwned['0,65,0'],42);
});
test('owned continuation returns to registered structure without model coordinates or a renewed lease',()=>{
 const {bot,entries}=fixture();bot.entity.position={x:118,y:65,z:0};entries.push({id:'b',from:'persona:p',dimension:'overworld',origin:{x:0,y:65,z:0},entrance:{x:1,y:66,z:-1},blueprint:{blocks:[],bounds:{}},design:{source:schematic()}});
 const goal=prepareBuild(bot,{mode:'edit',build_id:'b',schematic:{...schematic(),existingOffset:[0,0,0]}},'persona:p',{enabled:true});
 assert.deepEqual(goal.personaBuildReturn.target,entries[0].entrance);assert.deepEqual(goal.personaBuildPolicy.anchor,entries[0].origin);
});
test('verification records only unchanged enclosed original natural foundation as retained',()=>{
 const {buildVerification,verifiedEditOwnership}=require('../src/persona-build');
 const cell={x:0,y:65,z:0,material:'cobblestone'};
 const blueprint={origin:{x:0,y:65,z:0},blocks:[cell],empty:[],initialNames:{'0,65,0':'dirt'},initialBlocks:{'0,65,0':10}};
 const bot={blockAt:p=>p.x===0&&p.y===65&&p.z===0?{name:'dirt',stateId:10,boundingBox:'block'}:{name:'stone',stateId:1,boundingBox:'block'}};
 const report=buildVerification(bot,{blueprint});assert.equal(report.verified,true);assert.equal(report.exact_material_match,false);assert.equal(report.retained_blocks,1);assert.equal(report.retained_enclosed_natural[0].observed,'dirt');assert.equal(verifiedEditOwnership(bot,{blueprint}).size,0);
 for(const change of [{name:'diamond_block',stateId:10},{name:'dirt',stateId:11}]){const original=bot.blockAt;bot.blockAt=p=>p.x===0&&p.y===65&&p.z===0?{...change,boundingBox:'block'}:original(p);assert.equal(buildVerification(bot,{blueprint}).verified,false);bot.blockAt=original;}
 const original=bot.blockAt;bot.blockAt=p=>p.x===1?null:original(p);assert.equal(buildVerification(bot,{blueprint}).verified,false);bot.blockAt=original;
 cell.properties={facing:'north'};assert.equal(buildVerification(bot,{blueprint}).verified,false);delete cell.properties;
 blueprint.origin.y=64;assert.equal(buildVerification(bot,{blueprint}).verified,false);
});
test('editing unchanged original natural ground does not require completed enclosure',()=>{
 const {verifiedEditOwnership,buildVerification}=require('../src/persona-build');
 const cell={x:0,y:65,z:0,material:'cobblestone'},blueprint={origin:{x:0,y:65,z:0},blocks:[cell],empty:[],initialNames:{'0,65,0':'dirt'},initialBlocks:{'0,65,0':10}};
 const bot={blockAt:p=>p.x===0&&p.y===65&&p.z===0?{name:'dirt',stateId:10,boundingBox:'block'}:{name:'air',stateId:0,boundingBox:'empty'}};
 assert.equal(verifiedEditOwnership(bot,{blueprint}).size,0,'original natural ground is terrain, not an owned placed block');
 assert.equal(buildVerification(bot,{blueprint}).verified,false,'exposed ground cannot prove completed foundation');
 bot.blockAt=()=>({name:'dirt',stateId:11,boundingBox:'block'});assert.throws(()=>verifiedEditOwnership(bot,{blueprint}));
 bot.blockAt=()=>({name:'diamond_block',stateId:10,boundingBox:'block'});assert.throws(()=>verifiedEditOwnership(bot,{blueprint}));
});
test('actual stairs validator exposes sanitized actionable detail without accepting geometry',()=>{
 const {bot}=fixture();const source=schematic();source.palette=['oak_stairs'];source.regions=[{from:[0,0,0],to:[0,0,0],block:'oak_stairs',properties:{facing:'north'}}];
 assert.throws(()=>prepareBuild(bot,{mode:'fresh',build_id:null,schematic:source},'persona:p',{enabled:true}),err=>typeof err.validationDetail==='string'&&err.validationDetail.includes('half top or bottom')&&err.validationDetail.length<=240);
});
test('requested site anchors fresh work and rejects unrelated old structures before returning to them',()=>{
 const {bot,entries}=fixture();const site_binding={position:{x:20,y:65,z:20},dimension:'overworld',radius:32};
 const fresh=prepareBuild(bot,{mode:'fresh',build_id:null,schematic:schematic(),site_binding},'persona:p',{enabled:true});assert.deepEqual(fresh.buildAnchor,site_binding.position);assert.deepEqual(fresh.personaBuildReturn.target,site_binding.position);
 entries.push({id:'old',from:'persona:p',dimension:'overworld',origin:{x:300,y:65,z:0},blueprint:{origin:{x:300,y:65,z:0},blocks:[]},design:{source:schematic()}});
 for(const mode of ['finish','repair','edit'])assert.throws(()=>prepareBuild(bot,{mode,build_id:'old',schematic:null,site_binding},'persona:p',{enabled:true}),e=>e.code==='build_site_mismatch');
 fresh.blueprint={origin:{x:300,y:65,z:0},blocks:[]};assert.throws(()=>assertBuildPolicy(fresh),e=>e.code==='build_site_mismatch');
 assert.throws(()=>prepareBuild(bot,{mode:'fresh',build_id:null,schematic:schematic(),site_binding:{...site_binding,radius:1000}},'persona:p',{enabled:true}),e=>e.code==='invalid_build_site');
});
test('requested surface floor cannot bind a cave directly below, while roof height is independent',()=>{
 const {bot}=fixture();const site_binding={position:{x:0,y:65,z:0},dimension:'overworld',radius:32};
 const goal=prepareBuild(bot,{mode:'fresh',build_id:null,schematic:schematic(),site_binding},'persona:p',{enabled:true});
 goal.blueprint={origin:{x:0,y:50,z:0},blocks:[]};assert.throws(()=>assertBuildPolicy(goal),e=>e.code==='build_site_mismatch');
 goal.blueprint={origin:{x:0,y:64,z:0},blocks:[{x:0,y:78,z:0,material:'oak_planks'}]};assert.doesNotThrow(()=>assertBuildPolicy(goal));
});
test('site selector filters invalid floor before scoring and accepts wide centered footprints at small radius',()=>{
 const {Vec3}=require('vec3'),{validateSchematic,selectSchematicSite}=require('../src/designer'),{siteAllowed}=require('../src/persona-build');
 const makeBot=height=>({registry,game:{dimension:'overworld',minY:0,height:90},entity:{position:new Vec3(100,65,100)},entities:{},blockAt:p=>({name:p.y<=height(p.x,p.z)?'dirt':'air',boundingBox:p.y<=height(p.x,p.z)?'block':'empty',position:p,stateId:p.y<=height(p.x,p.z)?1:0})});
 const binding={position:{x:0,y:65,z:0},dimension:'overworld',radius:10},small=validateSchematic(schematic(),registry);
 const bot=makeBot((x,z)=>x>=-2&&x<=2&&z>=-2&&z<=2?59:64);
 const first=selectSchematicSite(bot,small,{anchor:binding.position});assert.equal(first.origin.y,59);
 const filtered=selectSchematicSite(bot,small,{anchor:binding.position,acceptOrigin:p=>siteAllowed(binding,p,small.source.size)});assert.ok(filtered);assert.equal(filtered.origin.y,64);
 const wideSource={...schematic(),size:[20,2,20],regions:[{from:[0,0,0],to:[19,0,19],block:'oak_planks',properties:null}]},wide=validateSchematic(wideSource,registry),tight={...binding,radius:1};
 const site=selectSchematicSite(makeBot(()=>64),wide,{anchor:tight.position,acceptOrigin:p=>siteAllowed(tight,p,wide.source.size)});assert.ok(site);assert.deepEqual(site.origin,{x:-10,y:64,z:-10});assert.equal(siteAllowed(tight,site.origin,wide.source.size),true);
});

test('registry descriptions separate dated completion from current loaded world evidence',()=>{
 const entry={id:'house',from:'persona:Tolik',status:'complete',personaVerifiedAt:'2026-11-04T11:10:00Z',personaVerification:{verified:true},origin:{x:0,y:64,z:0},blueprint:{blocks:[{x:0,y:64,z:0,material:'oak_planks'}],empty:[]}};
 const bot={game:{dimension:'overworld'},buildRegistry:{all:()=>[entry]},blockAt:()=>({name:'oak_planks'})};
 let d=describeBuilds(bot)[0];assert.equal(d.verified,true);assert.equal(d.verification_scope,'current_loaded_world');assert.equal(d.last_verified_at,entry.personaVerifiedAt);
 bot.blockAt=()=>null;d=describeBuilds(bot)[0];assert.equal(d.verified,false);assert.equal(d.verification.unknown_blocks,1);assert.equal(d.status,'complete');assert.equal(d.status_scope,'historical');assert.equal(d.last_verification.verified,true);
 bot.blockAt=()=>({name:'glass'});d=describeBuilds(bot)[0];assert.equal(d.verified,false);assert.equal(d.verification.mismatched_blocks,1);
 assert.equal(entry.personaVerification.verified,true);
});
test('snapshot build verification has a shared bounded read budget',()=>{
 const entry={id:'large',from:'persona:Tolik',status:'complete',personaVerifiedAt:'yesterday',origin:{x:0,y:64,z:0},blueprint:{blocks:Array(1000).fill({x:0,y:64,z:0,material:'oak_planks'}),empty:[]}};
 let reads=0;const bot={game:{dimension:'overworld'},buildRegistry:{all:()=>[entry]},blockAt:()=>{reads++;return null;}};
 const d=describeBuilds(bot)[0];assert.equal(reads,0);assert.equal(d.verified,false);assert.equal(d.verification,null);assert.equal(d.verification_scope,'not_checked_budget');
 entry.blueprint.blocks=Array.from({length:200},(_,x)=>({x,y:64,z:0,material:'oak_planks'}));
 bot.buildRegistry.all=()=>[entry,{...entry,id:'newest'}];
 const descriptions=describeBuilds(bot);assert.equal(reads,200);assert.equal(descriptions[0].verification_scope,'current_loaded_world');assert.equal(descriptions[1].verification_scope,'not_checked_budget');
});
