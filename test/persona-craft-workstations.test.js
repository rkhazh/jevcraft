'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11'),Block=require('prismarine-block')(registry),WorldSync=require('prismarine-world/src/worldsync');
const craft=require('../src/persona-craft'),authority=require('../src/mutation-authority');

function fixture(stock={copper_ingot:1,stick:2}){
 const bot=new EventEmitter(),blocks=new Map(),searches=[];let now=100,current=true,reserved=[];
 Object.assign(bot,{registry,version:'1.21.11',username:'actor',game:{dimension:'overworld',gameMode:'survival'},health:20,food:20,oxygenLevel:20,
  entity:{position:new Vec3(.508521324,64,.5),onGround:true},inventory:{items:()=>Object.entries(stock).filter(([,count])=>count>0).map(([name,count])=>({name,count,type:registry.itemsByName[name].id})),count:id=>stock[registry.items[id]?.name]||0},
  _pendingWorkstations:()=>reserved,_client:new EventEmitter(),pathfinder:{movements:{canDig:true},goto:()=>assert.fail('catalog must not navigate')}});
 const key=p=>`${bot.game.dimension}:${p}`,block=(name,p)=>{const b=Block.fromStateId(registry.blocksByName[name].defaultState,0);b.position=p.floored();return b;};
 bot.blockAt=p=>blocks.has(key(p.floored()))?blocks.get(key(p.floored())):block(p.y<64?'stone':'air',p);
 bot.world={getBlock:p=>bot.blockAt(p),raycast(...args){return WorldSync.prototype.raycast.apply(this,args)}};
 bot.findBlocks=options=>{searches.push(options);return [...blocks.values()].filter(b=>b&&key(b.position).startsWith(`${bot.game.dimension}:`)&&blocks.get(key(b.position))===b&&options.matching.includes(b.type)&&b.position.distanceTo(bot.entity.position)<=options.maxDistance).map(b=>b.position).sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position)).slice(0,options.count);};
 bot._client.write=()=>assert.fail('catalog must not send packets');require('mineflayer/lib/plugins/craft')(bot);
 return {bot,stock,searches,set:(p,name)=>blocks.set(key(p),name===null?null:block(name,p)),reserve:p=>{reserved=p?[{id:'other-work',position:p}]:[]},time:t=>{now=t},revoke:()=>{current=false},permit:p=>{
  const policy=authority.validateMutationAuthority({version:1,world_id:'world',principal:'actor',temporary_empty_placement:true,grants:[{id:'station',dimension:'overworld',operations:['container_withdraw'],source:'trusted fixture',cells:[{x:p.x,y:p.y,z:p.z}],expires_at:200}]},{worldId:'world',principal:'actor'});
  authority.installMutationAuthority(bot,{policy,worldId:'world',principal:'actor',world:{known:{},store:{save(){}}},now:()=>now,isCurrent:()=>current});
 }};
}
const offered=f=>craft.capabilities(f.bot,{enabled:true});
// Normalized recorded inventory and relative table/body positions from 055527:
// observations.jsonl SHA256 7a45f53d5eed77e199de378f7bd8654f791a792bfc55dc424f8c40df35e6799b.
// The surrounding flat stone/air is synthetic; this is not a live route replay.
test('recorded placed table keeps the carried recipe selectable without another table',async()=>{
 const f=fixture(),p=new Vec3(-2,64,-2);f.set(p,'crafting_table');
 assert.ok(offered(f).items.includes('copper_shovel'));assert.equal(offered(f).workstation_access,'unverified');
 const plan=craft.plan(f.bot,{item:'copper_shovel',count:1});assert.deepEqual(plan.map(s=>s.action),['craft']);assert.deepEqual(plan[0].consumes,{copper_ingot:1,stick:2});
 const station=await require('../src/work').workstation(f.bot,{check(){}},'crafting_table',{});assert.ok(station.position.equals(p));assert.equal(f.stock.crafting_table,undefined);
});
test('observed furnace permits ingredient-feasible smelting only with current contents authority and no reservation',()=>{
 const f=fixture({raw_iron:1,coal:1}),p=new Vec3(2,64,0);f.set(p,'furnace');f.permit(p);
 assert.ok(offered(f).items.includes('iron_ingot'));assert.equal(craft.plan(f.bot,{item:'iron_ingot',count:1})[0].action,'smelt');
 f.reserve(p);assert.ok(!offered(f).items.includes('iron_ingot'));f.reserve(null);assert.ok(offered(f).items.includes('iron_ingot'));
 f.time(201);assert.ok(!offered(f).items.includes('iron_ingot'));f.time(100);assert.ok(offered(f).items.includes('iron_ingot'));
 f.revoke();assert.ok(!offered(f).items.includes('iron_ingot'));assert.throws(()=>craft.plan(f.bot,{item:'iron_ingot',count:1}),/carried/);
});
test('cached catalog rechecks station removal, unloaded cells, range, dimension and reservations',()=>{
 const f=fixture(),p=new Vec3(2,64,0);f.set(p,'crafting_table');
 const native=f.bot.recipesFor;let reads=0;f.bot.recipesFor=(...args)=>{reads++;return native(...args)};
 assert.ok(offered(f).items.includes('copper_shovel'));const first=reads;offered(f);assert.equal(reads,first);
 for(const name of ['air',null]){f.set(p,name);assert.ok(!offered(f).items.includes('copper_shovel'));f.set(p,'crafting_table');assert.ok(offered(f).items.includes('copper_shovel'));}
 f.bot.entity.position=new Vec3(40.5,64,.5);assert.ok(!offered(f).items.includes('copper_shovel'));f.bot.entity.position=new Vec3(.5,64,.5);
 f.bot.game.dimension='the_nether';assert.ok(!offered(f).items.includes('copper_shovel'));f.bot.game.dimension='overworld';assert.ok(offered(f).items.includes('copper_shovel'));
 f.reserve(p);assert.ok(!offered(f).items.includes('copper_shovel'));f.reserve(null);assert.ok(offered(f).items.includes('copper_shovel'));
 assert.ok(f.searches.every(s=>s.count===8&&s.maxDistance===32));
});
test('observed workstations satisfy reusable requirements, never consumed ingredients or requested outputs',()=>{
 const f=fixture({iron_ingot:5,smooth_stone:3,cobblestone:8}),table=new Vec3(2,64,0),furnace=new Vec3(0,64,2);f.set(table,'crafting_table');f.set(furnace,'furnace');f.permit(furnace);
 assert.ok(!offered(f).items.includes('blast_furnace'));assert.throws(()=>craft.plan(f.bot,{item:'blast_furnace',count:1}),/furnace not carried/);
 const steps=craft.plan(f.bot,{item:'furnace',count:1});assert.equal(steps.length,1);assert.equal(steps[0].item,'furnace');assert.deepEqual(steps[0].consumes,{cobblestone:8});
 assert.throws(()=>craft.plan(f.bot,{item:'crafting_table',count:1}),/carried/);
});
