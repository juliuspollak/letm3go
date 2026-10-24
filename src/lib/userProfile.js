export function accountDisplayName(user) {
  const m = user?.user_metadata || {};
  return [m.display_name, m.letm3go_onboarding_v1?.display_name, m.full_name, m.name]
    .find(value => typeof value === 'string' && value.trim())?.trim().slice(0, 100) || '';
}

// The caller supplies the user returned by Auth getUser. RLS independently enforces
// its identity; neither Apple's optional email nor a form field chooses the owner.
export async function ensureUserProfile(client, user) {
  if (!user?.id) throw new Error('A verified account is required for the profile.');
  const read = () => client.from('profiles').select('id,display_name').eq('id', user.id).maybeSingle();
  let { data, error } = await read();
  if (error) throw new Error('Your account is signed in, but its profile could not be loaded.');
  const name = accountDisplayName(user);
  if (!data) {
    const created = await client.from('profiles').insert({ id: user.id, display_name: name }).select('id,display_name').single();
    if (created.error?.code === '23505') ({ data, error } = await read());
    else ({ data, error } = created);
  } else if (!data.display_name && name) {
    const updated = await client.from('profiles').update({ display_name: name }).eq('id', user.id).eq('display_name', '').select('id,display_name').maybeSingle();
    if (updated.error) throw new Error('Your profile name could not be saved.');
    data = updated.data || data;
  }
  if (error || data?.id !== user.id) throw new Error('The profile did not match this account.');
  return data;
}

export async function verifyAccountSession(client, session, {onProgress=()=>{},timeoutMs=15000}={}) {
  if (!session?.access_token || !session.user?.id) throw new Error('Sign in before checking your account.');
  async function bounded(operation,message){
    let timer;
    try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
  const { data, error } = await bounded(()=>client.auth.getUser(session.access_token),'The sign-in check timed out. Check your connection and try again. Your local recordings are preserved.');
  if (error || data?.user?.id !== session.user.id) throw new Error('Your sign-in could not be verified. Reconnect or sign in again.');
  const provider=data.user.identities?.some(i=>i.provider==='apple')?'Apple':'Email';
  const summary=`${provider} sign-in verified. Account ending ${data.user.id.slice(-8)}.`;
  onProgress(`${summary} Checking your profile…`);
  try{
    const profile=await bounded(()=>ensureUserProfile(client,data.user),'Profile check timed out.');
    return { userID:data.user.id,provider,profileVerified:profile.id===data.user.id };
  }catch{throw new Error(`${summary} Your profile check did not complete. Reconnect and retry; do not delete or reinstall the app.`);}
}

export async function saveProfileName(client, user, name) {
  await ensureUserProfile(client, user);
  const { data, error } = await client.from('profiles').update({ display_name: name }).eq('id', user.id).select('id').single();
  if (error || data?.id !== user.id) throw new Error('Your profile name could not be synchronized. It remains saved on this device.');
}
