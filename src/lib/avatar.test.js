import {describe,expect,it} from 'vitest';
import {avatarInitial,avatarNeedsConversion,isAvatarImage,resolveAvatar,shareableAvatar,AVATAR_LIMIT} from './avatar.js';

const photo='data:image/jpeg;base64,AAAA';
const png='data:image/png;base64,BBBB';

describe('shared avatar resolution',()=>{
 it('resolves the signed-in user by stable id, never by name or role',()=>{
  const result=resolveAvatar({userId:'julius',selfId:'julius',name:'Julius',photos:{majka:photo},selfAvatar:png});
  expect(result).toEqual({src:png,initial:'J',own:true});
 });

 it('prefers the freshest local copy for yourself and the shared copy for everyone else',()=>{
  const shared=resolveAvatar({userId:'JULIUS',selfId:'julius',photos:{julius:photo},selfAvatar:null});
  expect(shared.src).toBe(photo);
  expect(shared.own).toBe(true);
  const other=resolveAvatar({userId:'majka',selfId:'julius',photos:{majka:photo},selfAvatar:png});
  expect(other.src).toBe(photo);
  expect(other.own).toBe(false);
 });

 it('never reuses another person photo for the signed-in user',()=>{
  const result=resolveAvatar({userId:'julius',selfId:'julius',photos:{majka:photo},selfAvatar:null});
  expect(result.src).toBeNull();
  expect(result.initial).toBe('?');
 });

 it('falls back to initials only when no usable image exists',()=>{
  expect(resolveAvatar({userId:'majka',selfId:'julius',photos:{},name:'Majka'})).toEqual({src:null,initial:'M',own:false});
  expect(resolveAvatar({name:'  majka '}).initial).toBe('M');
  expect(avatarInitial('')).toBe('?');
 });

 it('only accepts image sources the WebView can render',()=>{
  expect(isAvatarImage(photo)).toBe(true);
  expect(isAvatarImage(png)).toBe(true);
  expect(isAvatarImage('https://example.com/photo.jpg')).toBe(true);
  expect(isAvatarImage('blob:letm3go-photo')).toBe(true);
  expect(isAvatarImage('javascript:alert(1)')).toBe(false);
  expect(isAvatarImage('http://insecure.example/photo.jpg')).toBe(false);
  expect(isAvatarImage('data:image/svg+xml;base64,AAAA')).toBe(false);
  expect(isAvatarImage(null)).toBe(false);
 });

 it('shares an existing JPEG unchanged and flags other formats for conversion',()=>{
  expect(avatarNeedsConversion(photo)).toBe(false);
  expect(avatarNeedsConversion(png)).toBe(true);
  expect(avatarNeedsConversion('https://example.com/photo.jpg')).toBe(true);
  expect(AVATAR_LIMIT).toBe(180000);
 });

 it('keeps an upload-ready JPEG without touching a canvas',async()=>{
  await expect(shareableAvatar(photo)).resolves.toBe(photo);
  await expect(shareableAvatar('not-a-photo')).resolves.toBeNull();
  await expect(shareableAvatar(null)).resolves.toBeNull();
 });
});
