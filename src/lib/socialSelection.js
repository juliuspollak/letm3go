export function sharingSelection({household,allFriends,selected=[],link}) {
 if(link) {
  if(household||allFriends||selected.length)throw new Error('Shareable links must be published separately from private audiences.');
  return {audience:'public',mode:null,recipients:[]};
 }
 if(household&&allFriends)return {audience:'friends',mode:'all',recipients:[]};
 if(household&&selected.length)return {audience:'friends',mode:'mixed',recipients:selected};
 if(household)return {audience:'household',mode:'household',recipients:[]};
 if(allFriends)return {audience:'friends',mode:'friends',recipients:[]};
 if(selected.length)return {audience:'friends',mode:'selected',recipients:selected};
 throw new Error('Choose at least one recipient or a public link.');
}
