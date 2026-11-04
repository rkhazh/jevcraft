'use strict';
const {playerIdentities}=require('./persona-roster');
function exclusivePersonaSpeech(bot){
 const speak=bot.chat.bind(bot);
 bot.chat=()=>false; // Native tactical narration must not impersonate the persona.
 return speak; // Already command-guarded; retain privately in the session.
}
function installPersonaChat(bot,{community=false,ready=()=>true,emit,now=Date.now}){
 const recent=new Map();
 function deliver(user,msg,source,uuid){
  if(!ready()||user===bot.username||typeof msg!=='string'||!msg.trim())return;
  msg=msg.slice(0,1000);const key=`${uuid}\0${msg}`,at=now(),last=recent.get(key);
  for(const [k,v]of recent)if(at-v.at>1500)recent.delete(k);
  if(last&&last.source!==source&&at-last.at<1500)return;
  if(recent.size>=128)recent.delete(recent.keys().next().value);
  recent.set(key,{source,at});emit({type:'chat',user,msg,sender_uuid:uuid,source,operator_authorized:source==='player_chat'});
 }
 function raw(data){const player=playerIdentities(bot).find(p=>p.uuid===String(data.sender).toLowerCase());if(player)deliver(player.name,data.plainMessage,'player_chat',player.uuid);}
 function formatted(text,position,original,sender){
  if(!community||position!=='system'||sender!=null||typeof text!=='string')return;
  const match=text.match(/^<([A-Za-z0-9_]{1,16})> ([^\r\n]+)$/u);if(!match)return;
  const player=playerIdentities(bot).find(p=>p.name===match[1]);if(player)deliver(player.name,match[2],'server_formatted',player.uuid);
 }
 bot._client.on('playerChat',raw);bot.on('messagestr',formatted);
 bot.once('end',()=>{recent.clear();bot._client.removeListener('playerChat',raw);bot.removeListener('messagestr',formatted)});
}
module.exports={exclusivePersonaSpeech,installPersonaChat};
