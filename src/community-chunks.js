'use strict';
const {Vec3}=require('vec3');
const {setTimeout:delay}=require('node:timers/promises');
// Recompute the actual 5x5 center throughout proxy/backend transitions.
async function waitForCommunityChunks(bot,{ended=()=>false,report=()=>{},now=()=>performance.now(),sleep=()=>delay(100),timeoutMs=30000}={}){
 const deadline=now()+timeoutMs;let stable=null,stableSince=0,lastCenter=null,reports=0;
 while(now()<deadline){
  if(ended())throw new Error('Connection ended during chunk readiness');
  const p=bot.entity?.position;
  if(p&&[p.x,p.y,p.z].every(Number.isFinite)&&bot.isAlive&&bot.game?.gameMode==='survival'){
   const x=Math.floor(p.x/16)*16,z=Math.floor(p.z/16)*16,key=`${x},${z}`;
   if(lastCenter!==key){if(reports++<6)report({center:{x,z},previous_center:lastCenter});lastCenter=key;}
   let loaded=0;
   for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)if(bot.world.getColumnAt(new Vec3(x+dx*16,0,z+dz*16)))loaded++;
   if(loaded===25){if(stable===key&&now()-stableSince>=200)return;if(stable!==key){stable=key;stableSince=now();}}
   else stable=null;
  }else stable=null;
  await sleep();
 }
 throw new Error('Community current-position 5x5 chunks not stably loaded within 30000ms');
}
module.exports={waitForCommunityChunks};
