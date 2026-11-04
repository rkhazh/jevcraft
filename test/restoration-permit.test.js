'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {blueprintFingerprint,loadRestorationAuthorization}=require('../src/restoration-permit');
const {installStructureMutationGuard,withBuildMutation}=require('../src/structure-mutations');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-restoration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'authorization.json'),p=new Vec3(4,65,6),id='11111111-1111-4111-8111-111111111111';
 const bp={origin:{x:4,y:65,z:6},blocks:[{...p,material:'oak_planks'}],empty:[],preserved:[],initialBlocks:{}};
 const goal={kind:'build',from:'persona:test',buildId:id,personaGoalId:'lease',continueBuild:{id,mode:'repair'},blueprint:structuredClone(bp),buildOwned:{}};
 const entry={id,from:goal.from,dimension:'overworld',blueprint:bp};let state={name:'dirt',stateId:12},valid=true,time=1000,session='s1';
 const bot=new EventEmitter();Object.assign(bot,{game:{dimension:'overworld'},entity:{position:new Vec3(0,60,0)},registry:{blocksByStateId:{12:{name:'dirt'}}},buildRegistry:{find:()=>entry,all:()=>[entry]},blockAt:q=>({...state,position:q})});bot._client=new EventEmitter();
 const data={approved:true,purpose:'restore_registered_cells',operation:'dig',authorization_id:'test',world_id:'test-world',dimension:'overworld',build_id:id,blueprint_sha256:blueprintFingerprint(bp),issued_at:999,expires_at:1100,cells:[{position:{...p},expected:{material:'dirt',state_id:12},desired:{material:'oak_planks',properties:{}}}]};
 const options={worldId:'test-world',consumptionDirectory:path.join(dir,'consumed'),sessionId:()=>session,validGoal:g=>valid&&g===goal,now:()=>time};
 const write=()=>fs.writeFileSync(file,JSON.stringify(data),{mode:0o600});write();const load=()=>loadRestorationAuthorization(file,options);
 return {dir,file,p,goal,entry,bot,data,options,write,load,state:v=>state=v,valid:v=>valid=v,time:v=>time=v,session:v=>session=v};
}
test('only explicit valid operator approval can match exact existing canonical repair cells',t=>{
 const f=fixture(t);let permit=f.load();assert.equal(permit.allows(f.bot,f.goal,f.p),true);
 for(const [field,value]of [['approved',false],['authorization_id',null],['operation','place'],['world_id','other'],['expires_at',900],['expires_at',5000]]){const old=f.data[field];f.data[field]=value;f.write();assert.throws(f.load);f.data[field]=old;}
 f.write();for(const mode of ['fresh','edit','resource']){f.goal.continueBuild.mode=mode;assert.equal(permit.allows(f.bot,f.goal,f.p),false);}f.goal.continueBuild.mode='repair';
 f.state({name:'dirt',stateId:13});assert.equal(permit.allows(f.bot,f.goal,f.p),false);f.state({name:'stone',stateId:12});assert.equal(permit.allows(f.bot,f.goal,f.p),false);f.state({name:'dirt',stateId:12});
 f.entry.blueprint.blocks[0].material='glass';assert.equal(permit.allows(f.bot,f.goal,f.p),false);
});
test('fingerprint ignores bookkeeping but binds geometry, properties, carving, preservation and origin',t=>{
 const f=fixture(t),bp=f.entry.blueprint,expected=blueprintFingerprint(bp);assert.equal(blueprintFingerprint({...bp,buildOwned:{a:1},updatedAt:100,initialBlocks:{a:2}}),expected);
 for(const other of [{...bp,origin:{x:5,y:65,z:6}},{...bp,empty:[{x:4,y:66,z:6,carved:true}]},{...bp,preserved:[{x:4,y:66,z:6}]},{...bp,blocks:[{...bp.blocks[0],properties:{facing:'north'}}]}])assert.notEqual(blueprintFingerprint(other),expected);
});
test('consumption is exclusive, durable across reload, and in-flight token is session scoped',t=>{
 const f=fixture(t),a=f.load(),b=f.load();assert.ok(a.allows(f.bot,f.goal,f.p));assert.ok(b.allows(f.bot,f.goal,f.p));
 const token=a.claim(f.bot,f.goal,f.p);assert.throws(()=>b.claim(f.bot,f.goal,f.p));assert.equal(f.load().allows(f.bot,f.goal,f.p),false);assert.equal(a.claim(f.bot,f.goal,f.p,token),token);
 f.session('s2');assert.throws(()=>a.claim(f.bot,f.goal,f.p,token));
});
test('failed durable writes cannot authorize a mutation',t=>{
 const f=fixture(t);fs.writeFileSync(f.options.consumptionDirectory,'not a directory');const permit=f.load();assert.throws(()=>permit.claim(f.bot,f.goal,f.p));
});
test('dispatch consumes only builder dig and rechecks state and lease after aiming',async t=>{
 const f=fixture(t),packets=[];let release;f.bot._client.write=(name,p)=>packets.push({name,p});f.bot.dig=async block=>{await new Promise(r=>release=r);f.bot._client.write('block_dig',{status:0,location:block.position});f.bot._client.write('block_dig',{status:2,location:block.position});};
 f.bot._restorationPermit=f.load();installStructureMutationGuard(f.bot,{validGoal:f.options.validGoal});const task={check(){}};
 await assert.rejects(f.bot.dig(f.bot.blockAt(f.p)),/Registered structure/);
 let pending=withBuildMutation(f.bot,task,f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p)));f.valid(false);release();await assert.rejects(pending);assert.equal(packets.length,0);assert.equal(fs.existsSync(f.options.consumptionDirectory),false);
 f.valid(true);pending=withBuildMutation(f.bot,task,f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p)));f.state({name:'stone',stateId:13});release();await assert.rejects(pending);assert.equal(packets.length,0);
 f.state({name:'dirt',stateId:12});pending=withBuildMutation(f.bot,task,f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p)));release();await pending;assert.equal(packets.length,2);assert.equal(f.load().allows(f.bot,f.goal,f.p),false);assert.deepEqual(f.goal.buildOwned,{});assert.deepEqual(f.goal.blueprint.initialBlocks,{});
});
test('completion packets cannot acquire approval and a scoped dig cannot restart after consumption',async t=>{
 const f=fixture(t),packets=[];let statuses=[2];f.bot._client.write=(name,p)=>packets.push(p.status);f.bot.dig=async()=>{for(const status of statuses)f.bot._client.write('block_dig',{status,location:f.p});};f.bot._restorationPermit=f.load();installStructureMutationGuard(f.bot,{validGoal:f.options.validGoal});const task={check(){}};
 await assert.rejects(withBuildMutation(f.bot,task,f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p))));assert.deepEqual(packets,[]);assert.equal(fs.existsSync(f.options.consumptionDirectory),false);
 statuses=[0,2,0];await assert.rejects(withBuildMutation(f.bot,task,f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p))));assert.deepEqual(packets,[0,2]);assert.equal(f.load().allows(f.bot,f.goal,f.p),false);
});
test('loader rejects symlinks and malformed data without exposing artifact contents',t=>{
 const f=fixture(t),link=path.join(f.dir,'link.json');fs.symlinkSync(f.file,link);assert.throws(()=>loadRestorationAuthorization(link,f.options),/authorization unavailable/);
 fs.writeFileSync(f.file,'{"sensitive_operator_note":"do not echo"');assert.throws(f.load,e=>!e.message.includes('sensitive')&&!e.message.includes('echo'));
});
test('paired cell claim failure sends no packet and leaves earlier claims spent',async t=>{
 const f=fixture(t),head=f.p.offset(0,0,-1);f.entry.blueprint.blocks.push({...head,material:'oak_planks'});f.goal.blueprint=structuredClone(f.entry.blueprint);f.data.blueprint_sha256=blueprintFingerprint(f.entry.blueprint);f.data.cells[0].expected={material:'white_bed',state_id:20};f.data.cells.push({...structuredClone(f.data.cells[0]),position:{...head}});f.write();
 f.bot.registry.blocksByStateId[20]={name:'white_bed'};f.bot.blockAt=p=>({name:'white_bed',stateId:20,position:p,getProperties:()=>({part:p.equals(head)?'head':'foot',facing:'north'})});const permit=f.load(),claim=permit.claim.bind(permit);permit.claim=(bot,goal,p,token)=>{if(p.equals(head))throw new Error('simulated storage failure');return claim(bot,goal,p,token);};
 let packets=0;f.bot._client.write=()=>packets++;f.bot.dig=async()=>f.bot._client.write('block_dig',{status:0,location:f.p});f.bot._restorationPermit=permit;installStructureMutationGuard(f.bot,{validGoal:f.options.validGoal});
 await assert.rejects(withBuildMutation(f.bot,{check(){}},f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p))));assert.equal(packets,0);assert.equal(f.load().allows(f.bot,f.goal,f.p),false);assert.equal(f.load().allows(f.bot,f.goal,head),true);
});
test('separate processes cannot consume the same approval twice',async t=>{
 const f=fixture(t),{spawn}=require('node:child_process');
 const input={file:f.file,store:f.options.consumptionDirectory,goal:f.goal,entry:f.entry,p:f.p,module:require.resolve('../src/restoration-permit')};
 const code=`const i=JSON.parse(process.argv[1]),{loadRestorationAuthorization}=require(i.module);const permit=loadRestorationAuthorization(i.file,{worldId:'test-world',consumptionDirectory:i.store,sessionId:()=> 's',validGoal:()=>true,now:()=>1000});const bot={game:{dimension:'overworld'},registry:{blocksByStateId:{12:{name:'dirt'}}},buildRegistry:{find:()=>i.entry},blockAt:()=>({name:'dirt',stateId:12})};try{permit.claim(bot,i.goal,i.p);console.log('claimed')}catch{console.log('denied')}`;
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',code,JSON.stringify(input)],{stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.on('error',reject);child.on('exit',n=>n===0?resolve(out.trim()):reject(new Error('claim child failed')));});
 assert.deepEqual((await Promise.all([run(),run()])).sort(),['claimed','denied']);
});

test('restoration finish packet is single-use within the in-flight dig',async t=>{
 const f=fixture(t),packets=[];f.bot._client.write=(name,p)=>packets.push(p.status);f.bot.dig=async()=>{for(const status of [0,2,2])f.bot._client.write('block_dig',{status,location:f.p});};f.bot._restorationPermit=f.load();installStructureMutationGuard(f.bot,{validGoal:f.options.validGoal});
 await assert.rejects(withBuildMutation(f.bot,{check(){}},f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p))));assert.deepEqual(packets,[0,2]);
});

test('conditional restoration scope is visible before any active goal without exposing artifact or token',t=>{
 const f=fixture(t),permit=f.load();f.valid(false);const d=permit.describe(f.bot,f.entry.id);assert.equal(d.status,'available');assert.equal(d.scope,'conditional_operator_restoration');assert.deepEqual(d.modes,['finish','repair']);assert.equal(d.operation,'dig');assert.equal(d.cells[0].consumed,false);assert.equal(d.cells[0].expected_state_matches,true);assert.equal(permit.allows(f.bot,f.goal,f.p),false);assert.equal(JSON.stringify(d).includes(f.file),false);assert.equal(d.authorization_id,undefined);assert.equal(permit.describe(f.bot,'other'),null);
 f.valid(true);permit.claim(f.bot,f.goal,f.p);assert.equal(permit.describe(f.bot,f.entry.id).cells[0].consumed,true);f.time(1200);assert.equal(permit.describe(f.bot,f.entry.id).status,'expired');
});

test('buried exact unconsumed approved cells remain missing in construction batches',t=>{
 const f=fixture(t),{buildCellComplete}=require('../src/build-blocks'),{remainingBuildBatch}=require('../src/build-batch'),{pendingRestoration}=require('../src/restoration-permit');f.state({name:'dirt',stateId:12,boundingBox:'block'});f.bot._restorationPermit=f.load();const cell=f.goal.blueprint.blocks[0],batch={cells:[cell]};
 assert.equal(buildCellComplete(f.bot,cell),true);assert.equal(pendingRestoration(f.bot,f.goal,cell),true);assert.deepEqual(remainingBuildBatch(f.bot,batch,f.goal),[cell]);
 f.valid(false);assert.equal(pendingRestoration(f.bot,f.goal,cell),false);assert.deepEqual(remainingBuildBatch(f.bot,batch,f.goal),[]);
 f.valid(true);f.bot._restorationPermit.claim(f.bot,f.goal,f.p);assert.equal(pendingRestoration(f.bot,f.goal,cell),false);
});
test('buried approved cell remains work through observed air to ordinary Survival placement',async t=>{
 const f=fixture(t),{remainingBuildBatch}=require('../src/build-batch'),{restorationIncomplete}=require('../src/restoration-permit'),{place}=require('../src/work');let material='dirt',stateId=12;
 f.bot.blockAt=q=>({position:q,name:q.equals(f.p)?material:'stone',stateId:q.equals(f.p)?stateId:1,boundingBox:q.equals(f.p)&&material==='air'?'empty':'block',shapes:q.equals(f.p)&&material==='air'?[]:[[0,0,0,1,1,1]],getProperties:()=>({})});
 Object.assign(f.bot,{health:20,food:20,oxygenLevel:20,entities:{},inventory:{items:()=>[{name:'oak_planks',count:1}]},equip:async item=>{f.bot.heldItem=item},lookAt:async()=>{},setControlState:()=>{},getControlState:()=>false,waitForTicks:async()=>{}});f.bot.entity.position=new Vec3(2.5,65,6.5);f.bot.entity.height=1.8;f.bot.entity.width=.6;
 f.bot._client.write=()=>{};f.bot.dig=async()=>{f.bot._client.write('block_dig',{status:0,location:f.p});f.bot._client.write('block_dig',{status:2,location:f.p});material='air';stateId=0;f.bot._client.emit('block_change',{location:f.p,type:0});};
 f.bot.placeBlock=async(ref,face)=>{assert.deepEqual(ref.position.plus(face),f.p);const old=f.bot.blockAt(f.p);material='oak_planks';stateId=15;f.bot.emit('blockPlaced',old,f.bot.blockAt(f.p));};
 f.bot._restorationPermit=f.load();installStructureMutationGuard(f.bot,{validGoal:f.options.validGoal});const task={check(){}},cell=f.goal.blueprint.blocks[0],batch={cells:[cell]};
 assert.deepEqual(remainingBuildBatch(f.bot,batch,f.goal),[cell]);await withBuildMutation(f.bot,task,f.goal,f.p,'dig',()=>f.bot.dig(f.bot.blockAt(f.p)));
 assert.equal(f.bot._restorationPermit.allows(f.bot,f.goal,f.p),false);assert.equal(restorationIncomplete(f.bot,f.goal,cell),true);assert.deepEqual(remainingBuildBatch(f.bot,batch,f.goal),[cell]);
 f.valid(false);assert.equal(restorationIncomplete(f.bot,f.goal,cell),false);f.valid(true);f.time(1200); // No new dig right; ordinary placement is independent of permit expiry.
 await withBuildMutation(f.bot,task,f.goal,f.p,'place',()=>place(f.bot,task,f.p,'oak_planks',{exact:restorationIncomplete(f.bot,f.goal,cell)}));
 assert.equal(material,'oak_planks');assert.equal(stateId,15);assert.equal(restorationIncomplete(f.bot,f.goal,cell),false);assert.deepEqual(remainingBuildBatch(f.bot,batch,f.goal),[]);
});

test('access scaffolding reserves the material of buried pending restoration',t=>{
 const f=fixture(t),{constructionMovement}=require('../src/construction-access');f.entry.blueprint.blocks[0].material='cobblestone';f.goal.blueprint=structuredClone(f.entry.blueprint);f.data.cells[0].desired.material='cobblestone';f.data.blueprint_sha256=blueprintFingerprint(f.entry.blueprint);f.write();f.state({name:'dirt',stateId:12,boundingBox:'block'});f.bot._restorationPermit=f.load();
 f.bot.registry.itemsByName={dirt:{id:1},cobblestone:{id:2}};f.bot.inventory={items:()=>[{name:'cobblestone',count:1,type:2}]};f.bot.pathfinder={movements:{canDig:true,scafoldingBlocks:[1,2],exclusionAreasPlace:[]}};
 const restore=constructionMovement(f.bot,f.goal);assert.equal(f.bot.pathfinder.movements.countScaffoldingItems(),0);assert.equal(f.bot.pathfinder.movements.getScaffoldingItem(),null);restore();assert.equal(f.bot.pathfinder.movements.canDig,true);
});
