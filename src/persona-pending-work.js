'use strict';
const {createHash}=require('node:crypto');
const {suspendPrevious}=require('./suspended-tasks');
const {dimension}=require('./memory');
const MAX_PENDING=8;
const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]))?{x:p.x,y:p.y,z:p.z}:null;
const samePoint=(a,b)=>!!a&&!!b&&['x','y','z'].every(k=>a[k]===b[k]);
const physical=goal=>!!goal?.smelting||!!goal?.smeltingSides?.length||Object.values(goal?.smeltingElsewhere||{}).some(Boolean);
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
const batch=value=>pick(value,['item','from','fuelItem','position','dimension','count','targetInventory','startedAt','at']);
function mechanical(goal){
 const out={};
 if(goal.smelting)out.smelting=batch(goal.smelting);
 if(goal.smeltingSides?.length)out.smeltingSides=goal.smeltingSides.map(batch);
 if(Object.values(goal.smeltingElsewhere||{}).some(Boolean))out.smeltingElsewhere=Object.fromEntries(Object.entries(goal.smeltingElsewhere).map(([key,value])=>[key,batch(value)]));
 if(goal.placedWorkstations?.length)out.placedWorkstations=structuredClone(goal.placedWorkstations);
 return out;
}
const id=goal=>goal.personaCraftContinuation?.id||goal.personaGoalId||`unscoped:${createHash('sha256').update(JSON.stringify(mechanical(goal))).digest('hex')}`;
function retain(saved){
 const records=suspendPrevious(saved,{retain:physical}).filter(physical),unique=new Map();
 for(const record of records){
  const batches=[record.smelting,...Object.values(record.smeltingElsewhere||{}),...(record.smeltingSides||[])].filter(Boolean);
  const seen=new Set();
  for(const [index,b]of batches.entries()){
   const key=JSON.stringify([b.dimension,b.position,b.startedAt??b.at??record.createdAt??null]);if(seen.has(key))continue;seen.add(key);
   const component=record.kind!=='craft'||batches.length>1;
   const checkpoint=record.personaCraftContinuation?.id&&batches.length===1?record.personaCraftContinuation.id:`${id(record).slice(0,100)}:${createHash('sha256').update(key).digest('hex').slice(0,16)}`;
   const compact={...pick(record,['version','from','personaId','personaWorldId','personaGoalId','createdAt','status']),
    kind:'craft',item:component?b.item:record.item,count:component?(b.targetInventory??b.count):record.count,
    smelting:batch(b),...(record.placedWorkstations?.length?{placedWorkstations:structuredClone(record.placedWorkstations)}:{}),
    personaCraftContinuation:{id:checkpoint,source_goal_id:record.personaCraftContinuation?.source_goal_id||record.personaGoalId,recorded_at:stamp({...record,smelting:b})}};
   unique.set(checkpoint,compact);
  }
 }
 return [...unique.values()];
}
const stamp=goal=>{
 if(Number.isFinite(goal.smelting?.startedAt))return goal.smelting.startedAt/1000;
 if(Number.isFinite(goal.smelting?.at))return goal.smelting.at/1000;
 if(goal.personaCraftContinuation&&Object.hasOwn(goal.personaCraftContinuation,'recorded_at'))return Number.isFinite(goal.personaCraftContinuation.recorded_at)?goal.personaCraftContinuation.recorded_at:null;
 const created=Date.parse(goal.createdAt||'');return Number.isFinite(created)?created/1000:null;
};
const order=(a,b)=>(a.recorded_at??Infinity)-(b.recorded_at??Infinity)||a.id.localeCompare(b.id);
function describe(goal,{worldId,personaId,dimension:here}){
 const b=goal.smelting;
 if(goal.kind!=='craft'||!goal.personaGoalId||goal.personaWorldId!==worldId||goal.personaId!==personaId||goal.from!==`persona:${personaId}`||!b||typeof b.dimension!=='string'||typeof b.item!=='string'||typeof b.from!=='string'||!Number.isInteger(b.count)||b.count<1||b.count>64||dimension(b.dimension)!==dimension(here)||!point(b.position)||!Number.isInteger(goal.count)||goal.count<1||goal.count>64)return null;
 return {id:id(goal),item:goal.item,count:goal.count,dimension:here,position:point(b.position),recorded_at:stamp(goal),status:'last_known',access:'unverified',source_goal_id:goal.personaCraftContinuation?.source_goal_id||goal.personaGoalId};
}
const advertise=(saved,context)=>retain(saved).map(g=>describe(g,context)).filter(Boolean).sort(order).slice(0,MAX_PENDING);
const select=(saved,spec,context)=>advertise(saved,context).find(p=>p.item===spec.item&&p.count===spec.count)||null;
const matches=(a,b)=>!!a&&!!b&&['id','item','count','dimension','source_goal_id'].every(k=>a[k]===b[k])&&samePoint(a.position,b.position);
function prepare(saved,spec,context,advertised){
 const observed=(advertised?.pending_work||[]).filter(p=>p.item===spec.item&&p.count===spec.count).sort(order)[0]||null;
 const current=select(saved,spec,context);
 if(observed||current){
  if(!matches(observed,current))throw Object.assign(new Error('Advertised pending craft checkpoint changed'),{code:'stale_pending_craft'});
  return {continuation:current};
 }
 return null;
}
function capacity(saved,additional=1){if(retain(saved).length+additional>MAX_PENDING)throw Object.assign(new Error(`There are ${MAX_PENDING} retained physical jobs; continue existing work before starting another furnace batch`),{code:'pending_work_capacity'});}
function adopt(saved,selected,context){
 const all=retain(saved),source=all.find(g=>id(g)===selected?.id);
 if(!source||!matches(selected,describe(source,context)))throw new Error('Pending craft checkpoint changed or belongs to another scope');
 return {mechanical:mechanical(source),remaining:all.filter(g=>id(g)!==selected.id)};
}
function stations(saved,{worldId,dimension:here}){
 return retain(saved).filter(g=>g.personaWorldId===worldId).flatMap(g=>[g.smelting,...Object.values(g.smeltingElsewhere||{}),...(g.smeltingSides||[])].filter(b=>b&&dimension(b.dimension)===dimension(here)&&point(b.position)).map(b=>({id:id(g),goal_id:g.personaGoalId,position:point(b.position)})));
}
function reserved(bot,p,goal){
 const own=goal?.personaCraftContinuation?.id||goal?.personaGoalId;
 return (bot._pendingWorkstations?.()||[]).some(s=>s.id!==own&&samePoint(s.position,p));
}
function observeBatch(saved,input,output,{remaining=saved.count}={}){
 const bad=item=>item&&(!Number.isInteger(item.count)||item.count<1);
 if(!Number.isInteger(remaining)||remaining<0||remaining>64||bad(input)||bad(output)||(input&&input.name!==saved.from)||(output&&output.name!==saved.item))throw new Error('Pending furnace contents changed; checkpoint remains unresolved');
 const total=(input?.count||0)+(output?.count||0);
 if(total>remaining)throw new Error('Observed furnace content exceeds the recorded remaining batch; checkpoint remains unresolved');
 return total;
}
module.exports={MAX_PENDING,physical,retain,advertise,select,matches,prepare,capacity,adopt,stations,reserved,observeBatch};
