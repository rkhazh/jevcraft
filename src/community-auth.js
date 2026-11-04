'use strict';
// This gate is deliberately server-specific; player chat can never authenticate it.
function communityAuth(bot, config, {password, successText, allowRegister=false, timeoutMs=45000}={}) {
 if(config.host!=='mc.agicraft.ru'||Number(config.port)!==25565||!password||/[\s\r\n]/.test(password))throw new Error('Invalid community authentication configuration');
 // Mineflayer installs chat during plugin injection. Queue this capture before
 // the session's command guard; retain only a private authentication sender.
 let authSend=null;
 const capture=()=>{if(typeof bot.chat==='function')authSend=bot.chat.bind(bot);};
 if(typeof bot.loadPlugin==='function')bot.loadPlugin(capture);else capture();
 function sendAuth(command){try{if(!authSend)throw new Error();authSend(command);}catch{fail('Community authentication transport unavailable');}}
 let authenticated=false,admitted=false,sent=false,registered=false,resolve,reject;
 const ready=new Promise((yes,no)=>{resolve=yes;reject=no});ready.catch(()=>{});
 bot.physicsEnabled=false;
 const timer=setTimeout(()=>fail('Community authentication timed out'),timeoutMs);
 function fail(reason){clearTimeout(timer);reject(new Error(reason));bot.quit(reason)}
 function message(text,position,original,sender){
  if(position!=='system'||sender!=null||admitted)return;
  if(text===`${config.username || 'SkipperJev'} joined the game`){authenticated=true;admitted=true;clearTimeout(timer);resolve();return;}
  if(successText && text===successText){authenticated=true;return;}
  if(/captcha|капч/i.test(text)){fail('Community authentication requires manual intervention');return;}
  if(/\/reg(?:ister)?\b/i.test(text)){
   if(!allowRegister){fail('Community registration requires explicit opt-in');return;}
   if(!registered){registered=true;sendAuth(`/reg ${password} ${password}`);}
   return;
  }
  if(!sent&&/\/login\b/.test(text)){sent=true;sendAuth(`/login ${password}`);}
 }
 bot.on('messagestr',message);
 bot.once('end',()=>{authSend=null;clearTimeout(timer);bot.removeListener('messagestr',message);if(!admitted)reject(new Error('Connection ended before authentication'))});
 return {ready, assertGameplay(){if(bot.game?.gameMode!=='survival')throw new Error('Community backend is not Survival');},get authenticated(){return authenticated}};
}
module.exports={communityAuth};
