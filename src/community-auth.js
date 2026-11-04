'use strict';
// This gate is deliberately server-specific; player chat can never authenticate it.
function communityAuth(bot, config, {password, successText, allowRegister=false, diagnostic=()=>{}, timeoutMs=45000}={}) {
 if(config.host!=='mc.agicraft.ru'||Number(config.port)!==25565||!password||/[\s\r\n]/.test(password))throw new Error('Invalid community authentication configuration');
 // Mineflayer installs chat during plugin injection. Queue this capture before
 // the session's command guard; retain only a private authentication sender.
 let authSend=null;
 const capture=()=>{if(typeof bot.chat==='function')authSend=bot.chat.bind(bot);};
 if(typeof bot.loadPlugin==='function')bot.loadPlugin(capture);else capture();
 function sendAuth(command){try{if(!authSend)throw new Error();authSend(command);}catch{fail('Community authentication transport unavailable');}}
 let diagnostics=0;
 function report(event,text){
  if(diagnostics>=12)return;diagnostics++;
  const clean=typeof text==='string'?text.split(password).join('[redacted]').replace(/\/(?:login|l|reg(?:ister)?)\b[^\r\n]*/gi,'[authentication command redacted]').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,240):undefined;
  try{diagnostic({event,...(clean!==undefined?{text:clean}:{})});}catch{}
 }
 let authenticated=false,admitted=false,sent=false,registered=false,resolve,reject;
 const ready=new Promise((yes,no)=>{resolve=yes;reject=no});ready.catch(()=>{});
 bot.physicsEnabled=false;
 const timer=setTimeout(()=>fail('Community authentication timed out'),timeoutMs);
 function fail(reason){report('failed',reason);clearTimeout(timer);reject(new Error(reason));bot.quit(reason)}
 function message(text,position,original,sender){
  if(position!=='system'||sender!=null||admitted)return;
  report('server_auth',String(text));
  if(text===`${config.username || 'SkipperJev'} joined the game`){authenticated=true;admitted=true;report('backend_join');clearTimeout(timer);resolve();return;}
  if(successText && text===successText){authenticated=true;return;}
  if(/captcha|капч/i.test(text)){fail('Community authentication requires manual intervention');return;}
  if(/\/reg(?:ister)?\b/i.test(text)){
   if(!allowRegister){fail('Community registration requires explicit opt-in');return;}
   if(!registered){registered=true;report('registration_sent');sendAuth(`/reg ${password} ${password}`);}
   return;
  }
  const loginPrompt=String(text).match(/\/(login|l)(?=\s|$)/i);
  if(!sent&&loginPrompt){sent=true;report('login_sent');const command=loginPrompt[1].toLowerCase()==='l'?'/l':'/login';sendAuth(`${command} ${password}`);}
 }
 bot.on('messagestr',message);
 bot.once('end',()=>{authSend=null;clearTimeout(timer);bot.removeListener('messagestr',message);if(!admitted)reject(new Error('Connection ended before authentication'))});
 return {ready, assertGameplay(){if(bot.game?.gameMode!=='survival')throw new Error('Community backend is not Survival');},get authenticated(){return authenticated}};
}
module.exports={communityAuth};
