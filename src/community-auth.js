'use strict';
// This gate is deliberately server-specific; player chat can never authenticate it.
function communityAuth(bot, config, {password, successText, timeoutMs=45000}={}) {
 if(config.host!=='mc.agicraft.ru'||Number(config.port)!==25565||!password||/[\s\r\n]/.test(password))throw new Error('Invalid community authentication configuration');
 let authenticated=false,admitted=false,sent=false,resolve,reject;
 const ready=new Promise((yes,no)=>{resolve=yes;reject=no});ready.catch(()=>{});
 bot.physicsEnabled=false;
 const timer=setTimeout(()=>fail('Community authentication timed out'),timeoutMs);
 function fail(reason){clearTimeout(timer);reject(new Error(reason));bot.quit(reason)}
 function message(text,position,original,sender){
  if(position!=='system'||sender!=null||admitted)return;
  if(text===`${config.username || 'SkipperJev'} joined the game`){authenticated=true;admitted=true;clearTimeout(timer);resolve();return;}
  if(successText && text===successText){authenticated=true;return;}
  if(/captcha|капч|\/reg(?:ister)?\b/i.test(text)){fail('Community authentication requires manual intervention');return;}
  if(!sent&&/\/login\b/.test(text)){sent=true;bot.chat(`/login ${password}`);}
 }
 bot.on('messagestr',message);
 bot.once('end',()=>{clearTimeout(timer);bot.removeListener('messagestr',message);if(!admitted)reject(new Error('Connection ended before authentication'))});
 return {ready, assertGameplay(){if(bot.game?.gameMode!=='survival')throw new Error('Community backend is not Survival');},get authenticated(){return authenticated}};
}
module.exports={communityAuth};
