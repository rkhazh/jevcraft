'use strict';
// Derived from offline-review-pending-smelt-restart-20261105.js; no live server. Actual session,
// persona admission, GoalStore, recipe graph and smelt are retained. Minecraft
// connection/station/window and idle-loop I/O are fixtures. No model calls.
const {test}=require('node:test');
test('real session retains invested craft through an unrelated goal and restart, then continues under a fresh lease',{timeout:12000},async()=>{
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3'),{randomUUID}=require('node:crypto');
const registry=require('minecraft-data')('1.21.11'),p=new Vec3(1,64,0),dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-audit-smelt-resume-'));
const oldEnv={...process.env},original=Module._load;let bot,session,nativeWork,starts=[],idles=[],input=null,fuel=null,closedWindows=0,models=0,output=null,takes=[],opened=0;
const Item=require('prismarine-item')(registry);
const stock={raw_copper:1,oak_planks:1,furnace:1,crafting_table:1};
const window={id:7,slots:[],inventoryStart:3,inventoryEnd:39,inputItem:()=>input,fuelItem:()=>fuel,outputItem:()=>output,takeOutput:async()=>{takes.push(require('../src/action-scope').actionAttribution(bot));stock.copper_ingot=(stock.copper_ingot||0)+output.count;output=null;},fuel:1,fuelSeconds:10,close(){closedWindows++;bot.emit('windowClose',window);bot.currentWindow=null;},putInput:async(_id,_meta,n)=>{stock.raw_copper-=n;input={name:'raw_copper',count:n};},putFuel:async(_id,_meta,n)=>{stock.oak_planks-=n;fuel={name:'oak_planks',count:n};}};
const sync=()=>{const item=i=>i?new Item(registry.itemsByName[i.name].id,i.count):null;window.slots=[item(input),item(fuel),item(output),...Object.entries(stock).filter(([,n])=>n>0).map(([name,count])=>item({name,count}))];while(window.slots.length<39)window.slots.push(null);bot._client.emit('window_items',{windowId:window.id,items:window.slots.map(Item.toNotch)});};
const makeBot=()=>{const b=new EventEmitter();b._client=new EventEmitter();b._client.write=()=>{};
 Object.assign(b,{loadPlugin(){},username:'Traveller',version:'1.21.11',health:20,food:20,oxygenLevel:20,isAlive:true,registry,
 game:{dimension:'overworld',gameMode:'survival'},time:{timeOfDay:1000},players:{},entities:{},entity:{id:0,position:new Vec3(.5,64,.5),onGround:true,height:1.8,effects:{},metadata:[]},
 inventory:{items:()=>Object.entries(stock).filter(([,n])=>n>0).map(([name,count])=>({name,count,type:registry.itemsByName[name].id})),count:id=>stock[registry.items[id]?.name]||0},
 pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},chat(){},quit(){b.emit('end','quit');},waitForChunksToLoad:async()=>{},
 blockAt:q=>q.equals(p)?{name:'furnace',position:p,boundingBox:'block'}:{name:q.y<64?'stone':'air',position:q,boundingBox:q.y<64?'block':'empty',shapes:q.y<64?[[0,0,0,1,1,1]]:[]},
 findBlocks:()=>[p],openFurnace:async()=>{opened++;b.currentWindow=window;sync();b.emit('windowOpen',window);return window},transfer:async options=>{assert.equal(options.sourceStart,2);assert.equal(options.sourceEnd,3);assert.equal(options.count,1);await window.takeOutput();sync();},_syncWindow:async w=>{if(w===window&&b.currentWindow===window)sync();},world:{raycast:()=>null}});
 require('mineflayer/lib/plugins/craft')(b);require('../src/interaction-guard').installGuard(b);return b;
};
const sessionFile=require.resolve('../src/session');
Module._load=function(name,parent,...rest){
 if(name==='mineflayer')return {createBot:()=>bot};
 if(name==='./movement'&&parent.filename===sessionFile)return {configureMovements(){}};
 if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
 if(name==='./slow-calls')return {install(){}};
 if(name==='./work'&&parent.filename===sessionFile)return {
  createSurvival:(_b,opt)=>({state:{},client:opt.client}),
  runGoal:async(b,t,g,store)=>{starts.push(g);if(g.kind==='craft')for(let i=0;i<3&&!await nativeWork.craftFromInventoryStep(b,t,g,()=>store.save(g));i++)t.check();g.status='complete';store.save(g);return {ok:true,goal:g};},
  runIdle:async(_b,t,g)=>{idles.push(g);while(!t.cancelled)await new Promise(r=>setTimeout(r,5));}
 };
 const result=original.call(this,name,parent,...rest);
 if(name==='./workstation-access'&&parent.filename.endsWith('/work.js'))return {...result,approachWorkstation:async(b,_t,_n,points)=>b.blockAt(points[0])};
 return result;
};
Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1',JEV_PERSONA_ITEMS:'crafting_table',MC_WORLD_ID:'offline-pending-batch'});
const until=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('fixture did not settle');};
const create=async({worldId='offline-pending-batch',actor='actor'}={})=>{
 process.env.MC_WORLD_ID=worldId;
 bot=makeBot();session=require('../src/session').createSession({host:'localhost',port:25565,username:'Traveller'},
  {systemOne:async()=>{models++;throw new Error('No model calls allowed');}},
  {stateDirectory:dir,runLedger:null,personaCraftFromInventory:true});
 bot.emit('spawn');await until(()=>session.persona.snapshot().connected);session.persona.setProfile({persona_id:actor,identity:'Offline character',motivations:['Choose useful work'],social_style:'brief'},session.persona.sessionId);return session;
};
const proposal=()=>{const s=session.persona.snapshot(),now=Date.now()/1000;return {schema_version:1,goal_id:randomUUID(),persona_id:'actor',session_id:s.session_id,observation_id:s.observation_id,issued_at:now,expires_at:now+60,state:'proposed',spec:{kind:'craft',item:'copper_ingot',count:1,deliver:false}};};
try{
 nativeWork=require('../src/work');await create();const first=proposal();
 assert.equal((await session.persona.submit(first)).status,'accepted');
 await until(()=>input?.count===1);
 // The fixture's existing furnace is burning; no replacement fuel remains.
 stock.oak_planks=0;
 await session.persona.cancel(first.goal_id);assert.ok(starts[0].smelting);
 const other={...proposal(),spec:{kind:'obtain',item:'crafting_table',count:1,deliver:false}};
 assert.equal((await session.persona.submit(other)).status,'accepted');await until(()=>session.persona.snapshot().last_result?.goal_id===other.goal_id);
 session.shutdown();await session.closed;
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'localhost-25565-Traveller.json'),'utf8'));
 assert.equal(saved.suspendedTasks.length,1);assert.ok(saved.suspendedTasks[0].smelting);assert.equal(saved.suspendedTasks[0].personaWorldId,'offline-pending-batch');
 for(const scope of [{worldId:'other-world'},{actor:'other-actor'}]){await create(scope);assert.deepEqual(session.persona.snapshot().craft_capabilities.pending_work,[]);session.shutdown();await session.closed;}
 const idleCount=idles.length;await create();await until(()=>idles.length>idleCount);
 const snapshot=session.persona.snapshot();assert.equal(snapshot.craft_capabilities.pending_work.length,1);assert.ok(!snapshot.craft_capabilities.items.includes('copper_ingot'));assert.equal(idles.at(-1).smelting,undefined);assert.equal(starts.length,2,'restart does not run old intent');
 // Another source already supplied the desired total. The retained physical
 // batch still requires an authoritative window observation and pickup.
 stock.copper_ingot=1;input=null;output={name:'copper_ingot',count:1};const beforeOpen=opened,second=proposal();
 assert.equal((await session.persona.submit(second)).status,'accepted');await until(()=>session.persona.snapshot().last_result?.goal_id===second.goal_id);
 const receipt=session.persona.snapshot().last_result;assert.equal(receipt.status,'complete');assert.equal(receipt.verified,true);assert.equal(stock.copper_ingot,2);assert.equal(takes.length,1);assert.equal(takes[0].goal_id,second.goal_id);assert.notEqual(takes[0].goal_id,first.goal_id);assert.ok(opened>beforeOpen);
 assert.equal(starts.at(-1).personaCraftContinuation.source_goal_id,first.goal_id);assert.notEqual(starts.at(-1).personaSessionId,starts[0].personaSessionId);assert.equal(starts.at(-1).smelting,undefined);assert.deepEqual(session.persona.snapshot().craft_capabilities.pending_work,[]);assert.equal(models,0);
}finally{
 session?.shutdown();await session?.closed;Module._load=original;process.env=oldEnv;
 fs.rmSync(dir,{recursive:true,force:true});
}
});
