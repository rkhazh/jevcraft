'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11'),windows=require('prismarine-windows')('1.21.11'),Item=require('prismarine-item')(registry);
const {installMutationAuthority,validateMutationAuthority,noteConfirmedPlacement}=require('../src/mutation-authority');
const protectedAnimals=require('../src/protected-animals');
const refused={name:'InteractionRefused'};
function fixture({shared=true,grants=[],own=false,contents=[],windowType='minecraft:generic_9x3',blockName='chest',properties={type:'single',facing:'north'}}={}){
 const bot=new EventEmitter(),packets=[],blocks=new Map(),p=new Vec3(3,64,0),client=new EventEmitter();
 bot.username='actor';bot.version='1.21.11';bot.registry=registry;bot.supportFeature=registry.supportFeature;bot._client=client;
 bot.game={dimension:'overworld',gameMode:'survival'};bot.entity={id:0,position:new Vec3(.5,64,.5),onGround:true};bot.entities={};bot.time={timeOfDay:14000};bot.health=20;bot.food=20;
 bot.blockAt=q=>blocks.get(q.floored().toString())||{name:'air',stateId:0,position:q.floored(),getProperties:()=>({}),light:0,skyLight:0};
 const set=(q,name=blockName,stateId=1,props=properties)=>blocks.set(q.toString(),{name,stateId,position:q,getProperties:()=>props});set(p);
 client.write=(name,data)=>packets.push({name,data});
 require('mineflayer/lib/plugins/inventory')(bot,{hideErrors:true});bot.quickBarSlot=0;bot.QUICK_BAR_START=36;
 bot.attack=e=>client.write('use_entity',{target:e.id,mouse:1});bot.getControlState=()=>false;
 bot.activateBlock=async()=>{queueMicrotask(()=>{
  const w=windows.createWindow(4,windowType,'Fixture');for(const [slot,name,count]of contents)w.updateSlot(slot,new Item(registry.itemsByName[name].id,count));
  bot.currentWindow=w;bot.emit('windowOpen',w);
 });};
 let authority,now=100;
 if(shared){const policy=validateMutationAuthority({version:1,world_id:'world',principal:'actor',temporary_empty_placement:true,grants},{worldId:'world',principal:'actor'});
  authority=installMutationAuthority(bot,{policy,worldId:'world',principal:'actor',world:{known:{},store:{save(){}}},now:()=>now});
  if(own)noteConfirmedPlacement(bot,bot.blockAt(p),{client,dimension:'overworld'});
 }
 protectedAnimals.installGuard(bot);
 const entity=(name,id=1,at=new Vec3(2,64,.5))=>{const e={name,id,uuid:`entity-${id}`,position:at,isValid:true,height:1.8,width:.6,metadata:[]};bot.entities[id]=e;return e;};
 const open=()=>bot.openBlock(bot.blockAt(p));
 let stateId=0;
 const sync=w=>client.emit('window_items',{windowId:w.id,stateId:++stateId,items:w.slots.map(Item.toNotch),carriedItem:Item.toNotch(w.selectedItem)});
 const serverSlot=(w,slot,name,count=1)=>client.emit('set_slot',{windowId:w.id,stateId:++stateId,slot,item:Item.toNotch(name?new Item(registry.itemsByName[name].id,count):null)});
 return {bot,p,packets,entity,open,set,authority,sync,serverSlot,Item,time:n=>{now=n}};
}
const grant=(p,operation='container_withdraw')=>({id:'operator-grant',dimension:'overworld',operations:[operation],source:'explicit fixture authority',cells:[{x:p.x,y:p.y,z:p.z}]});
test('shared-world unknown animals are refused independently of species and survival labels',()=>{
 for(const name of ['cow','chicken','sheep','wolf','villager']){
  const f=fixture();f.bot._goal={survivalAction:{action:'obtain_food'}};f.bot.health=4;
  assert.throws(()=>f.bot.attack(f.entity(name)),refused);assert.equal(f.packets.length,0);
 }
});
test('existing hostile and incoming-projectile defense remains available',()=>{
 const f=fixture();f.bot.attack(f.entity('zombie'));const wolf=f.entity('wolf',2);f.bot._hurtById={[wolf.id]:Date.now()};f.bot.attack(wolf);
 const ball=f.entity('fireball',3,new Vec3(2,65.5,.5));ball.velocity=new Vec3(-.5,0,0);f.bot.attack(ball);
 assert.equal(f.packets.filter(p=>p.name==='use_entity').length,3);
});
test('sweeping a hostile cannot damage an unauthorized bystander',()=>{
 const f=fixture(),zombie=f.entity('zombie');f.entity('cow',2,new Vec3(2.5,64,.5));f.bot.inventory.updateSlot(36,new Item(registry.itemsByName.iron_sword.id,1));
 assert.throws(()=>f.bot.attack(zombie),refused);f.bot.inventory.updateSlot(36,new Item(registry.itemsByName.iron_axe.id,1));f.bot.attack(zombie);
 assert.equal(f.packets.length,1);
});
test('raw attack dispatch and stale entity handles cannot bypass the shared boundary',()=>{
 const f=fixture(),cow=f.entity('cow');assert.throws(()=>f.bot._client.write('use_entity',{target:cow.id,mouse:1}),refused);
 const zombie=f.entity('zombie',2);f.entity('cow',2);assert.throws(()=>f.bot.attack(zombie),refused);
});
test('unknown container clicks and Mineflayer transfer helpers fail before optimistic inventory edits',async()=>{
 for(const operation of [async(b,w)=>b.clickWindow(0,0,1),async(b,w)=>b.moveSlotItem(0,w.inventoryStart),async(b,w)=>w.withdraw(registry.itemsByName.diamond.id,null,2)]){
  const f=fixture({contents:[[0,'diamond',4]]}),w=await f.open();await assert.rejects(operation(f.bot,w),refused);
  assert.equal(w.slots[0].count,4);assert.equal(w.selectedItem,null);assert.equal(f.packets.length,0);
 }
});
test('own container placement is not ownership of its preexisting contents',async()=>{
 const f=fixture({own:true,contents:[[0,'diamond',4]]}),w=await f.open();await assert.rejects(f.bot.clickWindow(0,0,1),refused);assert.equal(w.slots[0].count,4);
});
test('trusted container grants allow actual raw shift-click transfers',async()=>{
 const f=fixture({grants:[grant(new Vec3(3,64,0))],contents:[[0,'diamond',4]]}),w=await f.open();await f.bot.clickWindow(0,0,1);
 assert.equal(w.slots[0],null);assert.equal(w.slots.slice(w.inventoryStart).filter(i=>i?.name==='diamond').reduce((n,i)=>n+i.count,0),4);assert.equal(f.packets.filter(p=>p.name==='window_click').length,1);
});
test('personal inventory and personal crafting remain usable under shared authority',async()=>{
 const f=fixture();f.bot.inventory.updateSlot(9,new Item(registry.itemsByName.dirt.id,2));await f.bot.clickWindow(9,0,0);await f.bot.clickWindow(10,0,0);assert.equal(f.bot.inventory.slots[10].count,2);
 // The real window simulator exercises the crafting result; server updates are not needed for this admission check.
 const w=windows.createWindow(5,'minecraft:crafting','Crafting');f.bot.currentWindow=w;f.bot.emit('windowOpen',w);w.updateSlot(0,new Item(registry.itemsByName.stick.id,4));
 assert.doesNotThrow(()=>w.acceptClick({windowId:5,slot:0,mouseButton:0,mode:0,item:w.slots[0]}));assert.equal(w.selectedItem.name,'stick');
});
test('own deposits authorize only the confirmed deposited count, not additional contents',async()=>{
 const f=fixture({own:true}),w=await f.open();w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.diamond.id,2));
 await f.bot.clickWindow(w.inventoryStart,0,0);await f.bot.clickWindow(0,0,0);f.sync(w);
 w.updateSlot(0,new Item(registry.itemsByName.diamond.id,5));
 await assert.rejects(f.bot.clickWindow(0,0,1),refused);
 await f.bot.clickWindow(0,1,0).then(()=>assert.fail('right click would also take three')).catch(e=>assert.equal(e.name,'InteractionRefused'));
 // Exact deposited amount can be recovered after observing the extra items absent.
 w.updateSlot(0,new Item(registry.itemsByName.diamond.id,2));await f.bot.clickWindow(0,0,1);assert.equal(w.slots[0],null);
});
test('unconfirmed own deposit cannot mint a withdrawal allowance',async()=>{
 const f=fixture({own:true}),w=await f.open();w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.diamond.id,2));
 await f.bot.clickWindow(w.inventoryStart,0,0);await f.bot.clickWindow(0,0,0);
 await assert.rejects(f.bot.clickWindow(0,0,1),refused);
});
test('double-chest storage requires authority for both halves',async()=>{
 const p=new Vec3(3,64,0),f=fixture({grants:[grant(p)],windowType:'minecraft:generic_9x6',properties:{type:'left',facing:'north'},contents:[[0,'diamond',4]]});
 f.set(p.offset(1,0,0),'chest',2,{type:'right',facing:'north'});const w=await f.open();await assert.rejects(f.bot.clickWindow(0,0,1),refused);assert.equal(w.slots[0].count,4);
});
test('changed container and revoked session refuse even a previously granted window',async()=>{
 for(const change of [f=>f.set(f.p,'barrel',2,{}),f=>f.authority.close()]){
  const f=fixture({grants:[grant(new Vec3(3,64,0))],contents:[[0,'diamond',4]]}),w=await f.open();change(f);await assert.rejects(f.bot.clickWindow(0,0,1),refused);assert.equal(w.slots[0].count,4);
 }
});
test('standalone upstream behavior is preserved without shared-world policy',async()=>{
 const f=fixture({shared:false,contents:[[0,'diamond',4]]});f.bot.attack(f.entity('cow'));const w=await f.open();await f.bot.clickWindow(0,0,1);assert.equal(w.slots[0],null);
});
test('resource-hunt intent cannot manufacture defensive authority',()=>{
 const f=fixture(),cow=f.entity('cow');f.bot._provokedMobs=new Map([[cow.id,cow]]);
 assert.throws(()=>f.bot.attack(cow),refused);
});
test('observed removal revokes own deposit credit before foreign replenishment',async()=>{
 const f=fixture({own:true}),w=await f.open();w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.diamond.id,2));
 await f.bot.clickWindow(w.inventoryStart,0,0);await f.bot.clickWindow(0,0,0);f.sync(w);
 f.serverSlot(w,0,null);f.serverSlot(w,0,'diamond',2);
 await assert.rejects(f.bot.clickWindow(0,0,1),refused);assert.equal(w.slots[0].count,2);
});
test('closing an unobserved shared container ends deposit credit without a standing grant',async()=>{
 const f=fixture({own:true}),w=await f.open();w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.diamond.id,2));
 await f.bot.clickWindow(w.inventoryStart,0,0);await f.bot.clickWindow(0,0,0);f.sync(w);await f.bot.closeWindow(w);
 const next=await f.open();f.serverSlot(next,0,'diamond',2);await assert.rejects(f.bot.clickWindow(0,0,1),refused);
});
test('known personal ender-chest storage does not need somebody else\'s block ownership',async()=>{
 const f=fixture({blockName:'ender_chest',contents:[[0,'diamond',4]]}),w=await f.open();await f.bot.clickWindow(0,0,1);assert.equal(w.slots[0],null);
});
test('recipe-compatible loss and replacement does not prove ownership of furnace output',async()=>{
 const f=fixture({own:true,grants:[{...grant(new Vec3(3,64,0)),expires_at:101}],blockName:'furnace',windowType:'minecraft:furnace',properties:{facing:'north',lit:false}}),w=await f.open();
 w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.raw_iron.id,1));await f.bot.clickWindow(w.inventoryStart,0,0);await f.bot.clickWindow(0,0,0);f.sync(w);
 f.time(102);f.serverSlot(w,0,null);f.serverSlot(w,2,'iron_ingot',1);await assert.rejects(f.bot.clickWindow(2,0,1),refused);assert.equal(w.slots[2].count,1);
});
test('explicit workstation grants permit native furnace output transfers',async()=>{
 const f=fixture({grants:[grant(new Vec3(3,64,0))],blockName:'furnace',windowType:'minecraft:furnace',properties:{facing:'north',lit:true},contents:[[2,'iron_ingot',3]]}),w=await f.open();
 await f.bot.clickWindow(2,0,1);assert.equal(w.slots[2],null);
});
test('a refused packet restores current server observations rather than the old optimistic snapshot',async()=>{
 const f=fixture({grants:[grant(new Vec3(3,64,0))],contents:[[0,'diamond',4]]}),w=await f.open();
 w.once('updateSlot',()=>{f.serverSlot(w,0,'emerald',3);f.authority.close();});
 await assert.rejects(f.bot.clickWindow(0,0,1),refused);assert.equal(w.slots[0].name,'emerald');assert.equal(w.slots[0].count,3);assert.equal(f.packets.length,0);
});
test('server inventory changes during optimistic click require a fresh transfer even when grant remains active',async()=>{
 const f=fixture({grants:[grant(new Vec3(3,64,0))],contents:[[0,'diamond',4]]}),w=await f.open();
 w.once('updateSlot',()=>f.serverSlot(w,0,'emerald',3));await assert.rejects(f.bot.clickWindow(0,0,1),refused);assert.equal(w.slots[0].name,'emerald');assert.equal(f.packets.length,0);
});
test('food and loot affordances do not offer unauthorized shared resources',()=>{
 const f=fixture(),cow=f.entity('cow');assert.equal(require('../src/foraging').preyFood(f.bot,cow),undefined);
 f.bot.findBlocks=({matching})=>matching===registry.blocksByName.chest.id?[f.p]:[];
 assert.deepEqual(require('../src/looting').lootableChests(f.bot,{}),[]);
});
test('the bot is not its own protected bystander during melee or ranged defense',()=>{
 const f=fixture(),target=f.entity('zombie');Object.assign(f.bot.entity,{name:'player',type:'player',height:1.8,isValid:true});f.bot.entities[0]=f.bot.entity;
 f.bot.inventory.updateSlot(36,new Item(registry.itemsByName.iron_sword.id,1));assert.doesNotThrow(()=>f.bot.attack(target));
 assert.doesNotThrow(()=>require('../src/interaction-guard').assertAttack(f.bot,target,{shot:true}));
});
test('explicit entity grants are cell-scoped and expire before a later attack',()=>{
 const p=new Vec3(2,64,0),f=fixture({grants:[{...grant(p,'entity_attack'),expires_at:101}]}),cow=f.entity('cow');f.bot.attack(cow);
 cow.position=cow.position.offset(1,0,0);assert.throws(()=>f.bot.attack(cow),refused);cow.position=cow.position.offset(-1,0,0);f.time(102);assert.throws(()=>f.bot.attack(cow),refused);assert.equal(f.packets.length,1);
});
test('unknown raw window clicks are denied without a simulated transfer',async()=>{
 const f=fixture({contents:[[0,'diamond',4]]}),w=await f.open();assert.throws(()=>f.bot._client.write('window_click',{windowId:w.id,slot:0,mode:1,mouseButton:0}),refused);assert.equal(f.packets.length,0);
});
test('processing permission is checked before any ingredient is loaded, even into an empty own furnace',async()=>{
 const f=fixture({own:true,blockName:'furnace',windowType:'minecraft:furnace',properties:{facing:'north',lit:false}}),w=await f.open();w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.beef.id,1));
 await f.bot.clickWindow(w.inventoryStart,0,0);await assert.rejects(f.bot.clickWindow(0,0,0),refused);assert.equal(w.slots[0],null);assert.equal(w.selectedItem.name,'beef');
});
test('an empty observed own container can be removed, but unknown or unconfirmed contents cannot',async()=>{
 const {containerDestructionAllowed}=require('../src/interaction-guard'),f=fixture({own:true});assert.equal(containerDestructionAllowed(f.bot,f.p),false);
 const w=await f.open();assert.equal(containerDestructionAllowed(f.bot,f.p),true);f.serverSlot(w,0,'diamond',2);assert.equal(containerDestructionAllowed(f.bot,f.p),false);
});
test('supported copper chest families enforce both halves of the logical inventory',async()=>{
 const p=new Vec3(3,64,0),other=p.offset(1,0,0),name='waxed_weathered_copper_chest';
 for(const both of [true,false]){
  const g=grant(p);if(both)g.cells.push({x:other.x,y:other.y,z:other.z});
  const f=fixture({grants:[g],blockName:name,windowType:'minecraft:generic_9x6',properties:{type:'left',facing:'north'},contents:[[0,'diamond',4]]});f.set(other,name,2,{type:'right',facing:'north'});const w=await f.open();
  if(both){await f.bot.clickWindow(0,0,1);assert.equal(w.slots[0],null);}else await assert.rejects(f.bot.clickWindow(0,0,1),refused);
 }
});
test('native weapon selection does not treat self or item drops as sweep victims',async()=>{
 const f=fixture(),target=f.entity('zombie');Object.assign(f.bot.entity,{name:'player',type:'player',height:1.8,isValid:true});f.bot.entities[0]=f.bot.entity;f.entity('item',2);
 f.bot.inventory.updateSlot(36,new Item(registry.itemsByName.iron_sword.id,1));assert.equal(await require('../src/combat').unswept(f.bot,target),true);
 f.entity('cow',3);assert.equal(await require('../src/combat').unswept(f.bot,target),false);
});
test('own furnace placement does not authorize consuming unknown input or fuel',async()=>{
 const f=fixture({own:true,blockName:'furnace',windowType:'minecraft:furnace',properties:{facing:'north',lit:false},contents:[[1,'coal',3]]}),w=await f.open();
 w.updateSlot(w.inventoryStart,new Item(registry.itemsByName.raw_iron.id,1));await f.bot.clickWindow(w.inventoryStart,0,0);
 await assert.rejects(f.bot.clickWindow(0,0,0),refused);assert.equal(w.slots[1].count,3);assert.equal(w.slots[0],null);
});
