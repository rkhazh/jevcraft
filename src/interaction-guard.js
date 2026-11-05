'use strict';
// Shared-world permission for effects that do not edit blocks. The policy is
// the same trusted world/principal policy used by mutation-authority.
const {Vec3}=require('vec3'),{createHash}=require('node:crypto');
const authority=require('./mutation-authority');
const installed=new WeakMap();
class InteractionRefused extends Error { constructor(reason){super(`Shared-world interaction not authorized: ${reason}`);this.name='InteractionRefused';this.reason=reason;} }
const refuse=reason=>{throw new InteractionRefused(reason);};
const enabled=bot=>authority.hasMutationAuthority(bot);
function attackAllowed(bot,target){
 if(!enabled(bot))return true;
 if(!authority.mutationAuthorityCurrent(bot)||!target?.position||target.isValid===false||bot.entities?.[target.id]!==target)return false;
 if(authority.queryMutation(bot,'entity_attack',target.position.floored()).allowed)return true;
 // Existing danger evidence, independent of the requesting controller or a
 // food/resource goal. It retains the existing calm-spider/piglin exceptions.
 return require('./danger').hostileEntities(bot,64,{observedOnly:true}).includes(target)||require('./projectile-guard').incoming(bot).includes(target);
}
function assertAttack(bot,target,{sweep=false,shot=false}={}){
 if(!enabled(bot))return;
 if(!attackAllowed(bot,target))refuse('entity_requires_grant_or_current_threat');
 const protectedAnimals=require('./protected-animals');
 if(sweep&&/_sword$/.test(bot.heldItem?.name||'')&&bot.entity?.onGround&&!(bot.getControlState?.('sprint')||bot.controlState?.sprint)&&protectedAnimals.nearTarget(bot,target).length)refuse('sweep_would_hit_unauthorized_entity');
 if(shot&&protectedAnimals.nearShot(bot,target).length)refuse('shot_would_hit_unauthorized_entity');
}
const json=value=>JSON.stringify(value,(_key,v)=>typeof v==='bigint'?String(v):v);
const digest=value=>createHash('sha256').update(json(value)).digest('hex');
const blockIdentity=b=>{
 if(!b?.position)return null;
 const properties={...(b.getProperties?.()||{})};
 if(['furnace','blast_furnace','smoker'].includes(b.name))delete properties.lit;
 return json([b.name,b.position.x,b.position.y,b.position.z,properties]);
};
function sourceOf(bot,target,entity=false){
 if(entity)return {entity:target,uuid:target?.uuid,client:bot._client,dimension:bot.game?.dimension};
 if(!target?.position)return null;
 return {position:target.position.clone(),identity:blockIdentity(target),client:bot._client,dimension:bot.game?.dimension};
}
function footprint(bot,source,window){
 if(!source||source.client!==bot._client||source.dimension!==bot.game?.dimension||!authority.mutationAuthorityCurrent(bot))return null;
 if(source.entity){const e=source.entity;return bot.entities?.[e.id]===e&&e.uuid===source.uuid&&e.isValid!==false&&e.position?[e.position.floored()]:null;}
 const block=bot.blockAt(source.position);if(blockIdentity(block)!==source.identity)return null;
 const cells=[source.position],p=block.getProperties?.()||{};
 if((block.name==='chest'||block.name.endsWith('_chest'))&&block.name!=='ender_chest'&&p.type!=='single'){
  const right={north:[1,0],east:[0,1],south:[-1,0],west:[0,-1]}[p.facing];if(!right||!['left','right'].includes(p.type))return null;
  const sign=p.type==='left'?1:-1,q=source.position.offset(right[0]*sign,0,right[1]*sign),other=bot.blockAt(q),props=other?.getProperties?.()||{};
  if(other?.name!==block.name||props.facing!==p.facing||props.type!==(p.type==='left'?'right':'left'))return null;
  cells.push(q);
 }
 if(window?.inventoryStart===54&&cells.length!==2)return null;
 return cells;
}
function containerAllowed(bot,target,{entity=false}={}){
 if(!enabled(bot))return true;
 const cells=footprint(bot,sourceOf(bot,target,entity));
 return !!cells&&(target?.name==='ender_chest'||cells.every(p=>authority.queryMutation(bot,'container_withdraw',p).allowed));
}
function containerFootprint(bot,position){
 const target=position&&bot.blockAt(position);return target?footprint(bot,sourceOf(bot,target)):null;
}
const personal=w=>w?.id===0||w?.type==='minecraft:inventory'||w?.type==='minecraft:crafting';
function cloneItem(item){return item&&Object.assign(Object.create(Object.getPrototypeOf(item)),structuredClone(item));}
function itemKey(Item,item){return item?digest(Item.toNotch(Object.assign(cloneItem(item),{count:1}))):null;}
function totals(Item,slots,end){const out=new Map();for(const item of slots.slice(0,end))if(item){const k=itemKey(Item,item);out.set(k,(out.get(k)||0)+item.count);}return out;}
const delta=(before,after)=>new Map([...new Set([...before.keys(),...after.keys()])].map(k=>[k,(after.get(k)||0)-(before.get(k)||0)]).filter(([,n])=>n));
function installGuard(bot){
 if(!bot||installed.has(bot)||!bot._client?.write)return;
 const Item=require('prismarine-item')(bot.registry||bot.version),state={client:bot._client,opening:null,windows:new WeakMap(),ledgers:new Map(),token:null};installed.set(bot,state);
 const ownLedger=(source,cells)=>{
  if(source.entity)return null;
  const receipts=cells.map(p=>authority.confirmedPlacement(bot,p));if(receipts.some(r=>!r))return null;
  const key=json(receipts.map(r=>[r.world_id,r.principal,r.dimension,r.position,r.material,r.at]));
  let ledger=state.ledgers.get(key);if(!ledger){ledger={credit:new Map()};state.ledgers.set(key,ledger);if(state.ledgers.size>128)state.ledgers.delete(state.ledgers.keys().next().value);}
  return ledger;
 };
 function context(window){
  if(!authority.mutationAuthorityCurrent(bot)||state.client!==bot._client)refuse('interaction_session_closed');
  if(window!==bot.currentWindow&&window!==bot.inventory)refuse('window_is_not_current');
  const record=state.windows.get(window),cells=footprint(bot,record?.source,window);if(!cells)refuse('container_identity_unknown_or_changed');
  const ledger=ownLedger(record.source,cells);record.ledger=ledger;
  return {record,granted:!record.source.entity&&bot.blockAt(record.source.position)?.name==='ender_chest'||cells.every(p=>authority.queryMutation(bot,'container_withdraw',p).allowed),ledger};
 }
 function preview(window,click,accept,args){
  const sim=Object.assign(Object.create(Object.getPrototypeOf(window)),window,{_events:Object.create(null),_eventsCount:0,slots:window.slots.map(cloneItem),selectedItem:cloneItem(window.selectedItem)});
  accept.call(sim,{...click,item:sim.slots[click.slot]},...args);
  return {before:window.slots.map(cloneItem),cursor:cloneItem(window.selectedItem),after:sim.slots.map(cloneItem),afterCursor:cloneItem(sim.selectedItem),changes:delta(totals(Item,window.slots,window.inventoryStart),totals(Item,sim.slots,sim.inventoryStart))};
 }
 function checkPlan(window,plan){
  const c=context(window);
  if(!c.granted)for(const [k,n]of plan.changes)if(n<0&&(!c.ledger||(c.ledger.credit.get(k)||0)<-n))refuse('container_withdraw_requires_grant_or_confirmed_own_deposit');
  // Inserting into somebody else's processing inventory can consume their
  // inputs/fuel, even before anything is withdrawn.
  if(!c.granted&&/furnace|smoker|brewing|crafter/.test(window.type)&&[...plan.changes.values()].some(n=>n>0))refuse('processing_container_requires_authority');
  return c;
 }
 function guardWindow(window,source){
  if(!window||state.windows.has(window))return;
  const record={source,pending:[],server:window.slots.map(cloneItem),serverCursor:cloneItem(window.selectedItem),revision:0,debits:new Map()};state.windows.set(window,record);
  const accept=window.acceptClick;
  if(typeof accept!=='function')return;
  window.acceptClick=function(click,...args){
   if(!enabled(bot)||personal(window))return accept.call(this,click,...args);
   const plan=preview(window,click,accept,args);checkPlan(window,plan);plan.revision=record.revision;
   const result=accept.call(this,click,...args);
   state.token={window,click:{slot:click.slot,mouseButton:click.mouseButton,mode:click.mode},plan};return result;
  };
 }
 bot.on?.('windowOpen',window=>guardWindow(window,state.opening?.source));
 bot.on?.('windowClose',window=>{const r=state.windows.get(window);if(r){r.pending=[];r.ledger?.credit.clear();}if(state.token?.window===window)state.token=null;});
 for(const [method,entity]of [['openBlock',false],['openEntity',true]]){
  const open=bot[method];if(typeof open!=='function')continue;
  bot[method]=async function(target,...args){
   if(!enabled(bot))return open.call(this,target,...args);
   if(state.opening)refuse('overlapping_container_open');
   const opening={source:sourceOf(bot,target,entity)};state.opening=opening;
   try{return await open.call(this,target,...args);}finally{if(state.opening===opening)state.opening=null;}
  };
 }
 const write=state.client.write;
 state.client.write=function(name,packet,...args){
  if(!enabled(bot))return write.call(this,name,packet,...args);
  if(name==='attack'||name==='use_entity'&&packet?.mouse===1)assertAttack(bot,bot.entities?.[name==='attack'?packet.entityId:packet.target],{sweep:true});
  if(name!=='window_click')return write.call(this,name,packet,...args);
  const window=packet.windowId===0?bot.inventory:bot.currentWindow;
  if(!window||window.id!==packet.windowId)refuse('window_is_not_current');
  if(personal(window)){if(!authority.mutationAuthorityCurrent(bot)||state.client!==bot._client)refuse('interaction_session_closed');return write.call(this,name,packet,...args);}
  let token=state.token;
  if(token?.window!==window||!['slot','mouseButton','mode'].every(k=>token.click[k]===packet[k]))token=null;
  state.token=null;
  if(!token){if(!context(window).granted)refuse('container_click_without_checked_transfer');return write.call(this,name,packet,...args);}
  let c;
  try{c=checkPlan(window,token.plan);if(c.record.revision!==token.plan.revision)refuse('container_changed_during_click');}
  catch(err){const r=state.windows.get(window);window.slots=r.server.map(cloneItem);window.selectedItem=cloneItem(r.serverCursor);throw err;}
  const result=write.call(this,name,packet,...args);
  if(c.ledger){
   for(const [k,n]of token.plan.changes)if(n<0){c.ledger.credit.set(k,Math.max(0,(c.ledger.credit.get(k)||0)+n));c.record.debits.set(k,(c.record.debits.get(k)||0)-n);}
   const additions=[...token.plan.changes].filter(([,n])=>n>0);
   if(additions.length){c.record.pending.push({at:Date.now(),expected:token.plan.after.slice(0,window.inventoryStart).map(i=>i?json(Item.toNotch(i)):null),additions,ledger:c.ledger});if(c.record.pending.length>16)c.record.pending.shift();}
  }
  return result;
 };
 // Credit only after the server reports the requested contents, never from
 // optimistic acceptClick mutations or an old goal's chest/location claims.
 function confirmed(packet,all){
  if(!enabled(bot)||state.client!==bot._client)return;
  const window=bot.currentWindow,record=window&&state.windows.get(window);if(!record||packet.windowId!==window.id)return;
  const before=record.server;record.revision++;
  record.server=record.server.slice();
  if(all){record.server=packet.items.map(i=>Item.fromNotch(i));if(packet.carriedItem!==undefined)record.serverCursor=Item.fromNotch(packet.carriedItem);}
  else if(packet.slot>=0)record.server[packet.slot]=Item.fromNotch(packet.item);
  let c;try{c=context(window);}catch{return;}
  if(c.ledger){
   const changes=delta(totals(Item,before,window.inventoryStart),totals(Item,record.server,window.inventoryStart));
   for(const [k,n]of changes)if(n<0){
    const expected=Math.min(-n,record.debits.get(k)||0);record.debits.set(k,(record.debits.get(k)||0)-expected);
    const lost=Math.min(-n-expected,c.ledger.credit.get(k)||0);c.ledger.credit.set(k,Math.max(0,(c.ledger.credit.get(k)||0)-lost));
   }
  }
  const actual=record.server.slice(0,window.inventoryStart).map(i=>i?json(Item.toNotch(i)):null),now=Date.now();
  record.pending=record.pending.filter(p=>{
   if(now-p.at>10000||p.ledger!==c.ledger)return false;
   if(json(p.expected)!==json(actual))return true;
   for(const [k,n]of p.additions)p.ledger.credit.set(k,(p.ledger.credit.get(k)||0)+n);
   for(const [k,n]of p.ledger.credit)if(n<=0)p.ledger.credit.delete(k);
   while(p.ledger.credit.size>128)p.ledger.credit.delete(p.ledger.credit.keys().next().value);
   return false;
  });
 }
 state.client.on?.('window_items',packet=>confirmed(packet,true));state.client.on?.('set_slot',packet=>confirmed(packet,false));
 state.destructionAllowed=position=>{
  const window=bot.currentWindow,record=window&&state.windows.get(window),cells=footprint(bot,record?.source,window);
  if(!record||!cells?.some(p=>p.equals(position))||record.pending.length||[...record.debits.values()].some(n=>n>0))return false;
  if(!record.source.entity&&bot.blockAt(record.source.position)?.name==='ender_chest')return true;
  const ledger=ownLedger(record.source,cells);if(!ledger)return false;
  if(json(record.server.slice(0,window.inventoryStart).map(Item.toNotch))!==json(window.slots.slice(0,window.inventoryStart).map(Item.toNotch)))return false;
  return [...totals(Item,record.server,window.inventoryStart)].every(([k,n])=>(ledger.credit.get(k)||0)>=n);
 };
}
function containerDestructionAllowed(bot,position){return !enabled(bot)||!!installed.get(bot)?.destructionAllowed?.(position);}
module.exports={InteractionRefused,attackAllowed,assertAttack,containerAllowed,containerFootprint,containerDestructionAllowed,installGuard};
