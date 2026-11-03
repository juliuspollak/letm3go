// One list of people. Someone is a friend, in your household, or both, and appears
// once. Friendship and household stay separate permissions: this only joins the two
// lists for display, so it changes nothing about who can see what.
export function connectedPeople({friends=[],household=[],selfID=null}){
 const people=new Map();
 for(const friend of friends)people.set(friend.user_id,{id:friend.user_id,name:friend.display_name,friend:true,household:false});
 for(const member of household){
  if(member.user_id===selfID)continue;
  const known=people.get(member.user_id);
  people.set(member.user_id,{id:member.user_id,name:known?.name||member.display_name||'Member',friend:Boolean(known),household:true});
 }
 return [...people.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
}
// Friends who could be invited to the household, and whether they already have been.
export function invitableFriends({friends=[],members=[],invited=[]}){
 const inside=new Set(members.map(member=>member.user_id));
 return friends.filter(friend=>!inside.has(friend.user_id)).map(friend=>({...friend,invited:invited.includes(friend.user_id)}));
}
