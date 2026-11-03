// Polls answer with fresh arrays even when nothing changed. Storing those re-renders
// the whole app on every poll, which shows up as a stutter while scrolling. These
// helpers keep the value already in state when a new answer has the same content.
export function sameData(a,b){
 if(a===b)return true;
 try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}
}
// For a state setter: setPeople(keepIfSame(rows)).
export const keepIfSame=next=>previous=>sameData(previous,next)?previous:next;
