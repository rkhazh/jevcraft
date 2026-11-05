'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),Module=require('node:module'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11'),Block=require('prismarine-block')(registry),WorldSync=require('prismarine-world/src/worldsync'),record=require('./fixtures/workstation-permission-gap.json');
const skills=require('../src/skills'),authority=require('../src/mutation-authority');
// Keep production station selection, path search, placement and packet guard.
// Only actual physics travel and server placement delivery are simulated.
const load=Module._load;let work;
try{Module._load=function(name,parent,...args){const value=load.call(this,name,parent,...args);if(name==='./skills'&&parent.filename.endsWith('/workstation-access.js'))return {...value,navigate:async(bot,task,goal,options)=>{
 assert.equal(options.navigationOnly,true);assert.equal(options.onFoot,true);bot.routes++;
 const result=await skills.surveyRoute(bot,task,bot.pathfinder.movements,goal,500);assert.equal(result.status,'success');
 for(const n of result.path){assert.equal(n.toBreak.length,0);assert.ok(n.toPlace.every(p=>p.useOne));}
 const end=result.path.at(-1);if(end)bot.entity.position=new Vec3(end.x+.5,end.y,end.z+.5);bot.afterWalk?.();
}};return value;};work=require('../src/work');}finally{Module._load=load;}
function fixture({shift=0,deny=false,reserved=false,noRoute=false,revoke=false}={}){
 const bot=new EventEmitter(),blocks=new Map(),at=p=>new Vec3(p.x+shift,p.y,p.z+shift),key=p=>p.toString();
 function block(name,p,properties={}){const info=registry.blocksByName[name];let b=Block.fromStateId(info.defaultState,0);if(Object.keys(properties).length)for(let state=info.minStateId;state<=info.maxStateId;state++){const candidate=Block.fromStateId(state,0);if(Object.entries(properties).every(([k,v])=>candidate.getProperties()[k]===v)){b=candidate;break;}}b.position=p;return b;}
 const entries=structuredClone(record.builds);for(const e of entries){e.blueprint.blocks=e.blueprint.blocks.map(c=>({...c,...at(c)}));e.blueprint.empty=e.blueprint.empty.map(at);}
 for(const c of entries.find(e=>e.id==='project').blueprint.blocks)blocks.set(key(at({x:c.x-shift,y:c.y,z:c.z-shift})),block(c.material,new Vec3(c.x,c.y,c.z),c.properties));
 Object.assign(bot,{username:'actor',registry,version:'1.21.11',game:{dimension:'overworld',gameMode:'survival',minY:-64,height:384},health:20,food:20,oxygenLevel:20,time:{timeOfDay:1000},entities:{},entity:{position:at(record.position),height:1.8,onGround:true,effects:{},metadata:[]},controlState:{},routes:0,placements:[],packets:[],buildRegistry:{all:()=>entries},inventory:{items:()=>[{name:'furnace',type:registry.itemsByName.furnace.id,count:1}]},findBlocks:()=>[],waitForTicks:async()=>{},clearControlStates(){},setControlState(k,v){this.controlState[k]=v},getControlState(k){return !!this.controlState[k]},equip:async i=>{bot.heldItem=i},_syncWindow:async()=>{},dig:async()=>assert.fail('no access excavation')});
 bot.blockAt=p=>{p=p.floored();return blocks.get(key(p))||block(p.y<64?'grass_block':'air',p);};
 bot.world={getBlock:p=>bot.blockAt(p),raycast(...args){return WorldSync.prototype.raycast.apply(this,args);}};
 bot._client=new EventEmitter();bot._client.write=(name,data)=>bot.packets.push({name,data});
 bot.placeBlock=async(ref,face)=>{const q=ref.position.plus(face),old=bot.blockAt(q);bot._client.write('block_place',{location:ref.position,direction:[0,1,2,3,4,5][[new Vec3(0,-1,0),new Vec3(0,1,0),new Vec3(0,0,-1),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(1,0,0)].findIndex(d=>d.equals(face))],hand:0});blocks.set(key(q),block('furnace',q));bot.emit('blockPlaced',old,bot.blockAt(q));bot.placements.push(q);};
 bot._placeBlockWithOptions=bot.placeBlock;
 const policy=structuredClone(record.policy);for(const g of policy.grants)g.cells=g.cells.map(at);if(deny)policy.grants=policy.grants.filter(g=>!g.operations.includes('container_withdraw'));
 let current=true;authority.installMutationAuthority(bot,{policy:authority.validateMutationAuthority(policy,{worldId:'fixture',principal:'actor'}),worldId:'fixture',principal:'actor',world:{known:{},store:{save(){}}},isCurrent:()=>current});
 require('../src/structure-mutations').installStructureMutationGuard(bot);
 if(reserved)bot._pendingWorkstations=()=>policy.grants[0].cells.map(p=>({id:'invested',position:p}));if(revoke)bot.afterWalk=()=>{current=false};
 require('mineflayer-pathfinder').pathfinder(bot);const movements=new (require('../src/movement').SurvivalMovements)(bot);bot.pathfinder.setMovements(movements);
 if(noRoute)bot.pathfinder.getPathFromTo=function*(){yield {result:{status:'noPath',path:[]}};};
 return {bot,movements,set:(p,name)=>blocks.set(key(p),block(name,p))};
}
for(const shift of [0,173])test(`recorded permission gap can approach an eligible station site after translation ${shift}`,async()=>{
 const {bot,movements}=fixture({shift}),before={canDig:movements.canDig,allow1by1towers:movements.allow1by1towers};
 const result=await work.workstation(bot,{check(){}},'furnace',{});assert.equal(result.name,'furnace');assert.equal(bot.placements.length,1);assert.ok(bot.routes>=1);assert.ok(bot.placements[0].z-(Math.floor(record.position.z)+shift)>=4);
 assert.equal(authority.queryMutation(bot,'container_withdraw',result.position).allowed,true);for(const [k,v]of Object.entries(before))assert.equal(movements[k],v);
});
for(const options of [{noRoute:true},{deny:true},{reserved:true},{revoke:true}])test(`station fallback preserves refusal without effects ${JSON.stringify(options)}`,async()=>{
 const {bot}=fixture(options),start=Date.now();await assert.rejects(work.workstation(bot,{check(){}},'furnace',{}));assert.equal(bot.placements.length,0);assert.equal(bot.packets.length,0);assert.ok(Date.now()-start<3000);
});
test('fallback shares the existing three-placement limit and restores movements after refusal',async()=>{
 const {bot,movements}=fixture(),before=movements.canDig;let attempts=0;bot.equip=async()=>{attempts++;throw new Error('fixture placement refusal')};
 await assert.rejects(work.workstation(bot,{check(){}},'furnace',{}),/fixture placement refusal/);assert.equal(attempts,3);assert.equal(bot.placements.length,0);assert.equal(bot.packets.length,0);assert.equal(movements.canDig,before);
});
test('preserved notch fallback cannot cut registered walls when all project air cells are occupied',async()=>{
 const {bot,set}=fixture({noRoute:true}),plan=bot.buildRegistry.all().find(e=>e.id==='project').blueprint;
 // Synthetic obstruction variant; this does not claim the live room was filled.
 for(const p of plan.empty)set(new Vec3(p.x,p.y,p.z),'stone');bot.entity.position=new Vec3(1.5,65,5.5);set(new Vec3(1,65,5),'air');set(new Vec3(1,66,5),'air');
 assert.equal(authority.queryMutation(bot,'dig',new Vec3(2,65,5)).allowed,false);
 await assert.rejects(work.workstation(bot,{check(){}},'furnace',{}),/No place/);assert.equal(bot.placements.length,0);assert.equal(bot.packets.length,0);
});
test('cancellation after approach prevents placement and restores the caller movement policy',async()=>{
 const {bot,movements}=fixture(),before=movements.canDig;let cancelled=false;bot.afterWalk=()=>{cancelled=true};
 await assert.rejects(work.workstation(bot,{check(){if(cancelled)throw Object.assign(new Error('cancelled'),{name:'Cancelled'})}},'furnace',{}),{name:'Cancelled'});assert.equal(bot.packets.length,0);assert.equal(movements.canDig,before);
});
