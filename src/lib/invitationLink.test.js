import {it,expect} from 'vitest';
import {invitationLink,parseInvitationLink} from './invitationLink.js';
const code='123e4567-e89b-42d3-a456-426614174000';
it('opens both invitation types without granting sharing or accepting automatically',()=>{
 for(const kind of ['friend','household']){
  const link=invitationLink(kind,code);
  expect(parseInvitationLink(link)).toEqual({kind,code});
 }
});
it('rejects malformed and unrelated app URLs',()=>{
 expect(parseInvitationLink('https://example.com/invite?code='+code)).toBeNull();
 expect(parseInvitationLink('au.jpollak.journey://invite/friend?code=bad')).toBeNull();
 expect(parseInvitationLink('au.jpollak.journey://other/friend?code='+code)).toBeNull();
 expect(invitationLink('household','bad')).toBeNull();
});
