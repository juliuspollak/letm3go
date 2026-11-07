// Invitations can prefill the right screen, but never accept membership or share GPS automatically.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invitationLink(kind,code){
 if(!['friend','household'].includes(kind)||!uuid.test(String(code)))return null;
 return `au.jpollak.journey://invite/${kind}?code=${encodeURIComponent(code)}`;
}
export function parseInvitationLink(input){
 try{
  const url=new URL(input);
  if(url.protocol!=='au.jpollak.journey:'||url.hostname!=='invite'||url.username||url.password||url.port)return null;
  const kind=url.pathname.slice(1),code=url.searchParams.get('code');
  return ['friend','household'].includes(kind)&&uuid.test(code||'')?{kind,code}:null;
 }catch{return null;}
}
// The one invitation message, from Friends, Household or an activity's Share sheet.
export function invitationMessage(code,household=null){
 const intro=household?`Join me on letm3go and our household, ${household}!`:'Join me on letm3go!';
 return `Open my Letm3go invitation: ${invitationLink('friend',code)}\n\n${intro} Open the app, go to Social → Friends, and paste this invitation code to add me:\n\n${code}\n\nThis private invitation expires in 48 hours.`;
}
