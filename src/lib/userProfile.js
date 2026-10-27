export function accountDisplayName(user) {
  const m = user?.user_metadata || {};
  return [m.display_name, m.letm3go_onboarding_v1?.display_name, m.full_name, m.name]
    .find(value => typeof value === 'string' && value.trim())?.trim().slice(0, 100) || '';
}

// The caller supplies the user returned by Auth getUser. RLS independently enforces
// its identity; neither Apple's optional email nor a form field chooses the owner.
export async function ensureUserProfile(client, user) {
  if (!user?.id) throw new Error('A verified account is required for the profile.');
  const read = () => client.from('profiles').select('id,display_name,avatar').eq('id', user.id).maybeSingle();
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

export async function saveProfileName(client, user, name) {
  await ensureUserProfile(client, user);
  const { data, error } = await client.from('profiles').update({ display_name: name }).eq('id', user.id).select('id').single();
  if (error || data?.id !== user.id) throw new Error('Your profile name could not be synchronized. It remains saved on this device.');
}

// The profile photo is also stored on the owner's private profile row (RLS keeps
// it owner-only). Household and friend sharing still uses the avatar helper, so
// this is only the cross-device copy. The local preferences file stays
// authoritative; a failure here must never lose the photo on this device.
export async function saveProfileAvatar(client, user, avatar) {
  if (!user?.id) throw new Error('A verified account is required for the profile.');
  const value = typeof avatar === 'string' && avatar ? avatar : null;
  const { data, error } = await client.from('profiles').update({ avatar: value }).eq('id', user.id).select('id').maybeSingle();
  if (error || data?.id !== user.id) throw new Error('Your profile photo could not be synchronized.');
}
