'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME=/^[A-Za-z0-9_]{1,16}$/;
// Current Mineflayer player-info roster, not nearby entity labels or derived IDs.
// Ambiguous aliases are omitted rather than selecting a trusted name arbitrarily.
function playerIdentities(bot){
 const rows=[],byUuid=new Map(),byName=new Map();
 for(const p of Object.values(bot?.players||{})){
  if(typeof p?.uuid!=='string'||!UUID.test(p.uuid)||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(p.uuid)||typeof p.username!=='string'||!NAME.test(p.username))continue;
  const uuid=p.uuid.toLowerCase(),name=p.username,key=name.toLowerCase();
  rows.push({uuid,name,key});
  if(!byUuid.has(uuid))byUuid.set(uuid,new Set());byUuid.get(uuid).add(name);
  if(!byName.has(key))byName.set(key,new Set());byName.get(key).add(uuid);
 }
 const seen=new Set();
 return rows.filter(p=>byUuid.get(p.uuid).size===1&&byName.get(p.key).size===1&&!seen.has(p.uuid)&&seen.add(p.uuid))
  .sort((a,b)=>a.name.localeCompare(b.name)).slice(0,128).map(({uuid,name})=>({uuid,name}));
}
module.exports={playerIdentities};
