'use strict';
const {randomUUID}=require('node:crypto');
const {exact}=require('./persona-admission');
const {plainSpeech}=require('./persona-transport');
const KINDS=new Set(['continue','start_goal','cancel_goal','inspect','consult_terra','speak','update_work','wait']);
function bounded(v,limit=32768){
 const walk=(x,d=0)=>{if(d>16)throw Error('Action nesting exceeds bound');if(typeof x==='number'&&!Number.isFinite(x))throw Error('Nonfinite action number');if(Array.isArray(x)){if(x.length>128)throw Error('Action collection exceeds bound');x.forEach(y=>walk(y,d+1));}else if(x&&typeof x==='object'){for(const [k,y]of Object.entries(x)){if(k.length>128)throw Error('Invalid action key');walk(y,d+1);}}};walk(v);
 if(Buffer.byteLength(JSON.stringify(v))>limit)throw Error('Action bytes exceed bound');return structuredClone(v);
}
function clean(x){if(Array.isArray(x))return x.map(clean);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().filter(k=>!['context_revision','heartbeat_at','age_ms','age_seconds'].includes(k)).map(k=>[k,clean(x[k])]));return x;}
const dependenciesMatch=(a,b)=>JSON.stringify(clean(a))===JSON.stringify(clean(b));
function validateCandidate(c){
 if(!exact(c,['id','kind','args','source_ids','dependencies','expected','cost','expires_at'])||typeof c.id!=='string'||!c.id.length||c.id.length>128||!KINDS.has(c.kind))throw Error('Invalid candidate');
 const shapes={continue:['goal_id'],cancel_goal:['goal_id'],start_goal:['spec'],inspect:['query'],consult_terra:['question'],speak:['text','source_event_id','claim','work_revision'],update_work:['update'],wait:['seconds']};
 if(!exact(c.args,shapes[c.kind])||!Array.isArray(c.source_ids)||c.source_ids.some(i=>typeof i!=='string')||!c.dependencies||Array.isArray(c.dependencies)||typeof c.dependencies!=='object'||!c.cost||typeof c.expected!=='string'||c.expected.length>1000||!Number.isFinite(c.expires_at))throw Error('Invalid candidate args');
 if(c.kind==='speak'&&!plainSpeech(c.args.text)||c.kind==='wait'&&(!Number.isFinite(c.args.seconds)||c.args.seconds<1||c.args.seconds>60))throw Error('Invalid action args');
 if(['continue','cancel_goal'].includes(c.kind)&&typeof c.args.goal_id!=='string')throw Error('Invalid goal ID');
 if(c.kind==='start_goal'&&!['obtain','craft','come','follow','move','visit','build','edit'].includes(c.args.spec?.kind))throw Error('Invalid goal spec');
 return bounded(c);
}
function validateDecisionView(v){
 if(!exact(v,['schema_version','session_id','world_id','persona_id','generation','context_revision','observation_id','observed_at','dependencies','candidates','blockers'])||v.schema_version!==1)throw Error('Invalid view');bounded(v);
 for(const k of ['session_id','world_id','persona_id','observation_id'])if(typeof v[k]!=='string'||!v[k].length||v[k].length>128)throw Error('Invalid identity');
 if(!Number.isSafeInteger(v.generation)||v.generation<0||!Number.isSafeInteger(v.context_revision)||v.context_revision<0||!Number.isFinite(v.observed_at)||!v.dependencies||!Array.isArray(v.blockers)||!Array.isArray(v.candidates)||!v.candidates.length||v.candidates.length>24)throw Error('Invalid view bounds');
 const ids=new Set();for(const c of v.candidates){validateCandidate(c);if(ids.has(c.id))throw Error('Duplicate action ID');ids.add(c.id);}return structuredClone(v);
}
function validateSelection(value,menu){if(!value||value.menu_id!==menu.menu_id||value.session_id!==menu.session_id||!menu.candidates.some(c=>c.id===value.action_id))throw Error('Invalid selection');return structuredClone(value);}
module.exports={validateDecisionView,validateCandidate,validateSelection,dependenciesMatch,bounded};
