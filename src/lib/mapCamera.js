// The people map's camera, as the web layer knows it. The native map owns the
// moment-to-moment behaviour (hysteresis, gestures, edge avatars); this keeps the
// requested mode across tab changes, remounts and full screen.
//
// - all:    show everyone (the default)
// - free:   the user moved the map; nothing recentres it
// - person: follow one person
//
// `command` changes only for an explicit request. The native map applies a new
// command even over a remembered viewport, and ignores the mode otherwise, so a
// restored camera never overrides a newer "Show everyone" or chosen person.
export const initialCamera={mode:'all',personId:null,command:1};

export function cameraReducer(state,action){
 switch(action.type){
  case 'showAll':return {mode:'all',personId:null,command:state.command+1};
  case 'focus':return action.personId?{mode:'person',personId:String(action.personId),command:state.command+1}:{mode:'all',personId:null,command:state.command+1};
  // The native map changed mode itself (a gesture, an edge avatar, its own Show
  // everyone button). A report about an older command is out of date: a newer
  // request has already replaced it.
  case 'native':{
   if(action.command!==state.command||!['all','free','person'].includes(action.mode))return state;
   const personId=action.mode==='person'&&action.personId?String(action.personId):null;
   if(action.mode==='person'&&!personId)return state;
   if(state.mode===action.mode&&state.personId===personId)return state;
   return {...state,mode:action.mode,personId};
  }
  default:return state;
 }
}

// The intent sent with every update of the embedded map. The key includes the
// account, so one account's viewport is never restored for another.
export function cameraIntent(state,owner,includeRoutes=false){
 return {key:`people:${owner}`,mode:state.mode,personId:state.personId,command:state.command,includeRoutes};
}
