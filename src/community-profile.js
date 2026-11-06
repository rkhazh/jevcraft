'use strict';
const path=require('node:path');
function communityProfile(character='Skipper'){
 if(character==='Skipper')return {character,username:'SkipperJev',port:8769,build:false,worldId:'agicraft-community-1_21_11'};
 if(character==='TolikScheben')return {character,username:'TolikScheben',port:8770,build:true,worldId:'agicraft-community-1_21_11-tolik'};
 throw new Error('Unsupported community character');
}
function communityStateDirectory(character,runDirectory,workspaceRoot=path.resolve(__dirname,'../..'),override=null){
 communityProfile(character);
 if(override!==null){if(typeof override!=='string'||!path.isAbsolute(override))throw new Error('State directory must be absolute');return override;}
 return character==='TolikScheben'?path.join(workspaceRoot,'setup','jevcraft-community','characters','TolikScheben','body-state'):path.join(runDirectory,'state');
}
module.exports={communityProfile,communityStateDirectory};
