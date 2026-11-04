'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {Survival}=require('../src/survival');
const retreat=require('../src/shaft-retreat');

// A generic exposed column with solid side headroom. This reproduces the
// source-proven placement dependency, not an unrecorded live skip reason.
function fixture(){
 const cells=new Map(),placed=[],reports=[];
 const key=p=>`${p.x},${p.y},${p.z}`;
 const set=(p,name)=>cells.set(key(p),name);
 const bot={game:{dimension:'overworld',minY:-64,height:384},entity:{position:new Vec3(.5,0,.5),onGround:true},health:20,food:20,oxygenLevel:20,entities:{},time:{timeOfDay:1000},inventory:{items:()=>[{name:'dirt',count:64}],slots:[]},blockAt(p){
  p=p.floored();const name=cells.get(key(p))??(p.y<0||p.y===1&&(p.x!==0||p.z!==0)?'stone':'air');
  return {name,stateId:{air:0,stone:1,dirt:10,cobblestone:14}[name],position:p,diggable:true,boundingBox:name==='air'?'empty':'block',shapes:name==='air'?[]:[[0,0,0,1,1,1]]};
 }};
 const state={shelters:[],shaftRetreat:{dimension:'overworld',entry:{x:0,y:2,z:0},bottom:{x:0,y:-4,z:0},phase:'returning',excavationUsed:true,caps:[{position:{x:0,y:-2,z:0},name:'dirt',stateId:10}]}};
 const actions={place:async(bot,_task,p,name)=>{
  if(bot.blockAt(p).name===name)return;
  const sides=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  if(!sides.some(d=>bot.blockAt(p.offset(...d)).boundingBox==='block'))throw new Error('no adjacent solid anchor');
  placed.push({...p});set(p,name);require('../src/own-blocks').noteLaid(bot,bot.blockAt(p));
 }};
 const survival=Object.assign(Object.create(Survival.prototype),{bot,state,actions,report(_g,_s,action){reports.push(action);}});
 return {bot,state,placed,reports,set,survival,task:{check(){}},goal:{kind:'survive'}};
}

test('one sealing pass places a supported shell dependency then immediately closes the exposed roof',async()=>{
 const f=fixture();await f.survival.sealHere(f.task,f.goal,()=>{},[]);
 assert.equal(f.bot.blockAt(new Vec3(0,2,0)).name,'dirt');
 assert.equal(f.placed[0].y,2,'the first block supports the critical roof');
 assert.deepEqual(f.placed[1],{x:0,y:2,z:0});
});

test('an occupied critical roof is diagnosed and never forced',async()=>{
 const f=fixture();f.bot.entities={1:{name:'villager',id:1,position:new Vec3(.5,2,.5),height:1.8,width:.6}};
 await f.survival.sealHere(f.task,f.goal,()=>{},[]);
 assert.equal(f.bot.blockAt(new Vec3(0,2,0)).name,'air');
 assert.ok(!f.placed.some(p=>p.x===0&&p.y===2&&p.z===0));
 assert.ok(f.state.lastSealObstructions.cells.some(c=>c.position.y===2&&c.position.x===0&&c.position.z===0&&c.reason==='occupied'&&c.entity==='villager'));
});

test('an immediate open drop keeps its foot barrier ahead of the roof',async()=>{
 const f=fixture();for(let y=-1;y>=-4;y--)f.set(new Vec3(1,y,0),'air');
 await f.survival.sealHere(f.task,f.goal,()=>{},[]);
 assert.deepEqual(f.placed[0],{x:1,y:-1,z:0},'the actual missing footing is restored before the roof');
 assert.equal(f.bot.blockAt(new Vec3(0,2,0)).name,'dirt');
});

test('foot-only side blocks do not promote the roof ahead of exposed head-height walls',()=>{
 const f=fixture(),head=new Vec3(1,1,0),roof=new Vec3(0,2,0),support=new Vec3(1,2,0);
 for(const [x,z]of [[1,0],[-1,0],[0,1],[0,-1]]){f.set(new Vec3(x,0,z),'stone');f.set(new Vec3(x,1,z),'air');}
 f.set(new Vec3(1,3,0),'stone');
 const next=require('../src/closure-order').nextClosure(f.bot,new Vec3(0,0,0),[head,roof,support]);
 assert.deepEqual(next.cell,head);
});

test('already observed occupied cells survive an interrupted sealing pass',async()=>{
 const f=fixture();f.bot.entities={1:{name:'villager',id:1,position:new Vec3(.5,2,.5),height:1.8,width:.6}};
 f.survival.actions.place=async()=>{throw Object.assign(new Error('cancelled'),{name:'Cancelled'});};
 f.task.check=()=>{if(f.state.lastSealError)throw Object.assign(new Error('cancelled'),{name:'Cancelled'});};
 await assert.rejects(f.survival.sealHere(f.task,f.goal,()=>{},[]),{name:'Cancelled'});
 assert.ok(f.state.lastSealObstructions.cells.some(c=>c.reason==='occupied'&&c.entity==='villager'));
});

test('repeated placement refusals remain bounded and record the actual cell and reason',async()=>{
 const f=fixture();let attempts=0;f.survival.actions.place=async()=>{attempts++;throw new Error('server refused placement');};
 await f.survival.sealHere(f.task,f.goal,()=>{},[]);
 assert.equal(attempts,3);assert.ok(f.state.lastSealObstructions.cells.length<=12);
 assert.ok(f.state.lastSealObstructions.cells.some(c=>c.reason==='placement_refused'&&c.detail==='server refused placement'));
});

test('fresh own emergency cover is durable route evidence without rewriting descent caps',async()=>{
 const f=fixture(),original=JSON.parse(JSON.stringify(f.state.shaftRetreat.caps));
 await f.survival.sealHere(f.task,f.goal,()=>{},[]);
 const r=JSON.parse(JSON.stringify(f.state.shaftRetreat));
 assert.deepEqual(r.caps,original);
 assert.equal(r.phase,'returning');
 assert.ok(r.returnCover.some(c=>c.position.y===2&&c.name==='dirt'&&c.stateId===10&&c.source==='survival_cover'));
 assert.equal(retreat.capMatches(f.bot,r,new Vec3(0,2,0)),true);
});

test('a server-confirmed roof receipt survives cancellation after placement but before place returns',async()=>{
 const f=fixture(),place=f.survival.actions.place;
 f.survival.actions.place=async(...args)=>{await place(...args);if(args[2].equals(new Vec3(0,2,0)))throw Object.assign(new Error('cancelled after own placement'),{name:'Cancelled'});};
 f.task.check=()=>{if(f.state.lastSealError)throw Object.assign(new Error('cancelled'),{name:'Cancelled'});};
 await assert.rejects(f.survival.sealHere(f.task,f.goal,()=>{},[]),{name:'Cancelled'});
 assert.equal(f.bot.blockAt(new Vec3(0,2,0)).name,'dirt');
 assert.ok(f.state.shaftRetreat.returnCover?.some(c=>c.position.y===2&&c.name==='dirt'));
});

test('no-op placement, stale receipts, worldless goals and unrelated cells cannot create return-cover ownership',()=>{
 const f=fixture(),p=new Vec3(0,2,0);f.set(p,'dirt');
 f.goal.laid={'0,2,0':{name:'dirt',at:Date.now()}};
 assert.equal(retreat.noteReturnCover(f.bot,f.state,p,{since:Date.now(),previous:undefined}),false);
 require('../src/own-blocks').noteLaid(f.bot,f.bot.blockAt(p));
 const previous=f.bot._laid.get('0,2,0');
 assert.equal(retreat.noteReturnCover(f.bot,f.state,p,{since:previous.at,previous}),false);
 assert.equal(retreat.noteReturnCover(f.bot,f.state,p,{since:previous.at+1,previous:undefined}),false);
 assert.equal(retreat.noteReturnCover(f.bot,{...f.state,shaftRetreat:{...f.state.shaftRetreat,dimension:'the_nether'}},p,{since:previous.at,previous:undefined}),false);
 const side=new Vec3(1,2,0);f.set(side,'dirt');require('../src/own-blocks').noteLaid(f.bot,f.bot.blockAt(side));
 assert.equal(retreat.noteReturnCover(f.bot,f.state,side,{since:previous.at,previous:undefined}),false);
 assert.equal(f.state.shaftRetreat.returnCover,undefined);
});
