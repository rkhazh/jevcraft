'use strict';
const {Vec3}=require('vec3');
const label=value=>typeof value==='string'&&value.length?value.slice(0,64):null;
const finitePosition=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
// Same loaded entity/position sources as recorder/observer.js, without its
// terrain scan. This is proximity knowledge, not a rendered/line-of-sight view.
function nearbyWorld(bot) {
 const result={biome:null,ground_block:null,feet_block:null,head_block:null,nearby_entities:[]};
 const here=bot.entity?.position;if(!finitePosition(here))return result;
 const origin=new Vec3(Math.floor(here.x),Math.floor(here.y),Math.floor(here.z));
 const block=dy=>{try{return bot.blockAt?.(origin.offset(0,dy,0))??null;}catch(_){return null;}};
 const ground=block(-1),feet=block(0),head=block(1);
 result.ground_block=label(ground?.name);result.feet_block=label(feet?.name);result.head_block=label(head?.name);
 const biome=feet?.biome??ground?.biome??head?.biome;
 result.biome=label(typeof biome==='object'?biome?.name:typeof biome==='string'?biome:bot.registry?.biomes?.[biome]?.name);
 const nearby=[];
 for(const entity of Object.values(bot.entities||{})) {
  if(!entity||entity===bot.entity||(bot.entity.id!==undefined&&entity.id===bot.entity.id)||!finitePosition(entity.position))continue;
  const distance=Math.hypot(entity.position.x-here.x,entity.position.y-here.y,entity.position.z-here.z);
  if(distance>24)continue;
  nearby.push({entity,distance});
 }
 nearby.sort((a,b)=>a.distance-b.distance);
 result.nearby_entities=nearby.slice(0,12).map(({entity,distance})=>({
  name:label(entity.username)||label(entity.name)||'unknown',type:label(entity.type)||'unknown',distance:Math.round(distance*10)/10,
  ...(Number.isFinite(entity.health)&&entity.health>=0?{health:entity.health}:{}),
 }));
 return result;
}
module.exports={nearbyWorld};
