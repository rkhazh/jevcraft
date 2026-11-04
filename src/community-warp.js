'use strict';
const {waitForCommunityChunks}=require('./community-chunks');
// A single explicitly authorized destination; never accepts model command text.
async function warpToAi(bot,send,{timeoutMs=20000,waitChunks=waitForCommunityChunks}={}){
 if(!bot.isAlive||bot.game?.gameMode!=='survival')throw new Error('Warp requires live Survival backend');
 const origin=bot.entity?.position?.clone();
 if(!origin)throw new Error('Warp requires observed origin');
 let disconnected=false;const disconnectedListener=()=>{disconnected=true};bot.once('end',disconnectedListener);
 try{
 await new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);bot.removeListener('forcedMove',moved);bot.removeListener('end',ended);error?reject(error):resolve();};
  const ended=()=>finish(new Error('Connection ended during startup warp'));
  const moved=()=>{const p=bot.entity?.position;if(p&&p.distanceTo(origin)>=2)finish();};
  const timer=setTimeout(()=>finish(new Error('Startup warp teleport not observed')),timeoutMs);
  bot.on('forcedMove',moved);bot.once('end',ended);
  try{send('/warp ai');}catch{finish(new Error('Startup warp transport unavailable'));}
 });
 // The server must supply the destination world; a command ack is insufficient.
 if(disconnected)throw new Error('Connection ended during startup warp');
 await waitChunks(bot,{ended:()=>disconnected});
 }finally{bot.removeListener('end',disconnectedListener);}
}
module.exports={warpToAi};
