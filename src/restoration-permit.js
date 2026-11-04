'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
const point=p=>({x:p.x,y:p.y,z:p.z});
const key=p=>`${p.x},${p.y},${p.z}`;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const position=p=>exact(p,['x','y','z'])&&Object.values(p).every(n=>Number.isInteger(n)&&Math.abs(n)<=30000000);
function blueprintFingerprint(bp){
 if(!bp||!position(bp.origin)||!Array.isArray(bp.blocks)||!Array.isArray(bp.empty)||bp.blocks.length+bp.empty.length>14000)throw new Error('Invalid selected blueprint');
 const cells=(values,block)=>values.map(p=>{if(!position(point(p))||block&&typeof p.material!=='string')throw new Error('Invalid selected cell');return block?{...point(p),material:p.material,properties:p.properties||{}}:{...point(p),carved:!!p.carved};}).sort((a,b)=>a.x-b.x||a.y-b.y||a.z-b.z);
 if(bp.preserved!==undefined&&!Array.isArray(bp.preserved))throw new Error('Invalid preserved cells');
 return hash(sorted({origin:point(bp.origin),blocks:cells(bp.blocks,true),empty:cells(bp.empty,false),preserved:cells(bp.preserved||[],false)}));
}
function readRestorationAuthorization(filename,{worldId,sessionId,validGoal,consumptionDirectory,now=()=>Date.now()/1000}={}){
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data;
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>32768||st.uid!==process.getuid?.()||(st.mode&0o077))throw new Error('Unsafe restoration authorization file');data=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 const fail=()=>{throw new Error('Invalid or unapproved restoration authorization');};
 if(!exact(data,['approved','purpose','operation','authorization_id','world_id','dimension','build_id','blueprint_sha256','issued_at','expires_at','cells'])||data.approved!==true||data.purpose!=='restore_registered_cells'||data.operation!=='dig'||typeof data.authorization_id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(data.authorization_id)||data.world_id!==worldId||typeof data.dimension!=='string'||!/^[-a-z0-9_:]{1,80}$/.test(data.dimension)||typeof data.build_id!=='string'||!/^[a-f0-9-]{36}$/.test(data.build_id)||!/^[a-f0-9]{64}$/.test(data.blueprint_sha256)||![data.issued_at,data.expires_at].every(Number.isFinite)||data.issued_at>now()+1||data.expires_at<=now()||data.expires_at<=data.issued_at||data.expires_at-data.issued_at>3600||!Array.isArray(data.cells)||!data.cells.length||data.cells.length>16)fail();
 const keys=new Set();for(const c of data.cells){if(!exact(c,['position','expected','desired'])||!position(c.position)||!exact(c.expected,['material','state_id'])||typeof c.expected.material!=='string'||!/^[_a-z0-9]{1,80}$/.test(c.expected.material)||!Number.isSafeInteger(c.expected.state_id)||c.expected.state_id<0||!exact(c.desired,['material','properties'])||typeof c.desired.material!=='string'||!c.desired.properties||typeof c.desired.properties!=='object'||Array.isArray(c.desired.properties)||keys.has(key(c.position)))fail();keys.add(key(c.position));}
 if(typeof consumptionDirectory!=='string'||!path.isAbsolute(consumptionDirectory))fail();
 const directory=path.join(consumptionDirectory,hash(data.authorization_id));
 const marker=c=>path.join(directory,hash(key(c.position)));
 const matches=(bot,goal,p,token)=>{
  try{
   if(now()<data.issued_at-1||now()>=data.expires_at||!validGoal?.(goal)||!sessionId?.()||goal?.kind!=='build'||!['finish','repair'].includes(goal.continueBuild?.mode)||goal.continueBuild.id!==data.build_id||goal.buildId!==data.build_id||String(bot.game?.dimension||'').replace(/^minecraft:/,'')!==data.dimension)return null;
   const entry=bot.buildRegistry?.find(data.build_id);if(!entry||entry.from!==goal.from||String(entry.dimension).replace(/^minecraft:/,'')!==data.dimension||blueprintFingerprint(entry.blueprint)!==data.blueprint_sha256||blueprintFingerprint(goal.blueprint)!==data.blueprint_sha256)return null;
   const c=data.cells.find(c=>key(c.position)===key(p)),desired=entry.blueprint.blocks.find(c=>key(c)===key(p)),block=bot.blockAt(p);
   if(!c||!desired||JSON.stringify(sorted(c.desired))!==JSON.stringify(sorted({material:desired.material,properties:desired.properties||{}}))||block?.name!==c.expected.material||block?.stateId!==c.expected.state_id||bot.registry?.blocksByStateId?.[c.expected.state_id]?.name!==c.expected.material)return null;
   if(token){if(token.session!==sessionId()||token.goal!==goal||token.cell!==key(p)||token.authorization!==data.authorization_id)return null;}
   else if(fs.existsSync(marker(c)))return null;
   return c;
  }catch{return null;}
 };
 return {
  allows:(bot,goal,p,token)=>!!matches(bot,goal,p,token),
  claim(bot,goal,p,token){
   const c=matches(bot,goal,p,token);if(!c)throw new Error('Restoration permission no longer matches');if(token)return token;
   try{fs.mkdirSync(consumptionDirectory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
   const base=fs.lstatSync(consumptionDirectory);if(!base.isDirectory()||base.isSymbolicLink()||base.uid!==process.getuid?.()||(base.mode&0o077))throw new Error('Unsafe restoration consumption root');
   try{fs.mkdirSync(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
   const st=fs.lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw new Error('Unsafe restoration consumption directory');
   const descriptor=fs.openSync(marker(c),'wx',0o600);
   try{fs.writeFileSync(descriptor,JSON.stringify({authorization_id:data.authorization_id,cell:point(p),consumed_at:now(),session_id:sessionId(),goal_id:goal.personaGoalId}));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
   for(const folder of [directory,consumptionDirectory,path.dirname(consumptionDirectory)]){const dirfd=fs.openSync(folder,'r');try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}}
   return {authorization:data.authorization_id,session:sessionId(),goal,cell:key(p)};
  }
 };
}
function loadRestorationAuthorization(...args){try{return readRestorationAuthorization(...args);}catch{throw new Error('Restoration authorization unavailable, invalid or unapproved');}}
module.exports={blueprintFingerprint,loadRestorationAuthorization};
