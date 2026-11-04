'use strict';
function communityProfile(character='Skipper'){
 if(character==='Skipper')return {character,username:'SkipperJev',port:8769,build:false,worldId:'agicraft-community-1_21_11'};
 if(character==='TolikScheben')return {character,username:'TolikScheben',port:8770,build:true,worldId:'agicraft-community-1_21_11-tolik'};
 throw new Error('Unsupported community character');
}
module.exports={communityProfile};
