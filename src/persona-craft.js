'use strict';
const {knowledge,planCatalog}=require('./knowledge');
const {isFuel,itemsPerFuel}=require('./fuel');
const {observedWorkstations}=require('./workstation-access');
const cache=new WeakMap();
const restricted=goal=>goal?.kind==='craft'&&goal.personaCraftPolicy?.source==='carried_inventory';
const inventory=bot=>Object.fromEntries(Object.entries((bot.inventory?.items()||[]).reduce((out,i)=>{out[i.name]=(out[i.name]||0)+i.count;return out;},{})).sort(([a],[b])=>a.localeCompare(b)));
function blocked(reason){return Object.assign(new Error(`Craft from carried inventory blocked: ${reason}`),{name:'Blocked',personaCraftTerminal:true});}
// A conservative direct-recipe catalog, not a new acquisition planner. Native
// recipesFor checks the real version's ingredients and alternatives. The chosen
// desired total is checked separately against Jev's existing dependency graph.
function capabilities(bot,{enabled=false}={}){
 const result={enabled:enabled===true,source:'carried_inventory',items:[],max_count:64,quantity_preflight:true,workstation_access:'unverified'};
 if(!enabled||!bot.registry||!bot.inventory||typeof bot.recipesFor!=='function')return result;
 const stock=inventory(bot),observed=Object.fromEntries(['crafting_table','furnace'].map(name=>[name,stock[name]?[]:observedWorkstations(bot,name)]));
 // Fresh bounded observations/permissions/reservations invalidate the recipe
 // cache; no path search runs in this snapshot-facing catalog.
 const key=JSON.stringify([bot.game?.dimension,stock,Object.fromEntries(Object.entries(observed).map(([name,points])=>[name,points.map(p=>[p.x,p.y,p.z,bot.blockAt(p)?.stateId])]))]);
 let entry=cache.get(bot);
 if(!entry||entry.key!==key){
  const data=knowledge(bot.registry),items=new Set();
  for(const name of Object.keys(data.recipes)){
   const item=bot.registry.itemsByName[name];
   if(item&&(stock[name]||0)<64&&bot.recipesFor(item.id,null,1,stock.crafting_table||observed.crafting_table.length?{}:null).length)items.add(name);
  }
  if((stock.furnace||observed.furnace.length)&&Object.entries(stock).some(([name,n])=>isFuel(name)&&n*itemsPerFuel(name)>=1)){
   for(const [name,inputs] of Object.entries(data.smelting))if(bot.registry.itemsByName[name]&&(stock[name]||0)<64&&inputs.some(input=>stock[input]>0))items.add(name);
  }
  entry={key,items:[...items].sort()};cache.set(bot,entry);
 }
 result.items=[...entry.items];return result;
}
function assertInputs(bot,step){
 const stock=inventory(bot);
 for(const [name,count] of Object.entries(step.consumes||{}))if((stock[name]||0)<count)throw blocked(`carried ${name} changed before ${step.action}`);
}
function assertRecipeInputs(bot,recipe){
 const stock=inventory(bot);
 for(const delta of recipe.delta){
  const name=bot.registry.items[delta.id]?.name;
  if(delta.count<0&&(stock[name]||0)<-delta.count)throw blocked(`carried ${name} changed before recipe click`);
 }
}
function plan(bot,spec,{available}={}){
 if(!bot.registry?.itemsByName[spec.item]||!Number.isInteger(spec.count)||spec.count<1||spec.count>64)throw blocked('unsupported item or desired total');
 const stock=inventory(bot),data=knowledge(bot.registry);
 if(!data.recipes[spec.item]&&!data.smelting[spec.item])throw blocked('no supported crafting or smelting recipe');
 if(!available){
  available={...stock};
  for(const name of ['crafting_table','furnace'])if(!available[name]&&spec.item!==name&&observedWorkstations(bot,name).length)available[name]=1;
 }
 let steps;
 try{steps=planCatalog(bot.registry,spec.item,spec.count,available,{dimension:bot.game?.dimension});}
 catch(error){throw blocked(error.message);}
 if(steps.some(step=>!['craft','smelt'].includes(step.action)))throw blocked('requested quantity needs inputs not carried; harvesting is outside this craft');
 // Observed reusable stations may satisfy requirements, but their presence is
 // never inventory to spend in a recipe (e.g. an upgrade consuming a furnace).
 const ledger={...stock};
 for(const step of steps){
  for(const [name,count] of Object.entries(step.consumes||{})){
   if((ledger[name]||0)<count)throw blocked(`recipe would spend ${name} not carried`);
   ledger[name]-=count;
  }
  for(const [name,count] of Object.entries(step.produces||{}))ledger[name]=(ledger[name]||0)+count;
 }
 return steps;
}
module.exports={capabilities,plan,assertInputs,assertRecipeInputs,restricted,blocked};
