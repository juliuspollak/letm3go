import {describe,expect,it} from 'vitest';
import {ACTIVITY_TYPES,CHOOSABLE_ACTIVITY_TYPES} from './activityTypes.js';
import {emptyGrouping,changeGrouping} from './journeyGrouping.js';
import {applyChanges,groupingChanges} from './journeyMetadata.js';
import {activityPresentation} from './activityPresentation.js';
import {typesWithCurrent} from './ropeSkipping.js';
import {activityCapabilities} from './activityCapabilities.js';

const OWNER='11111111-1111-4111-8111-111111111111';
const act=(activity,id='a1')=>({id,activity,source:'watch',ownerID:OWNER,startedAt:1000,endedAt:1900,title:activity,date:'2026-11-17',durationSeconds:900,minutes:15,distanceMeters:0,distance:0,points:[],details:{}});

describe('one list of activity types',()=>{
 it('holds every type that can be recorded, including the subtypes',()=>{
  // The Watch records these (WatchCatalog), the phone starts Gym, and automatic recording detects Driving and Unknown.
  for(const type of ['Walking','Running','Cycling','MTB','Road cycling','Hiking','Kitesurfing','Driving','Gym','Rope skipping','Other','Unknown'])expect(ACTIVITY_TYPES,type).toContain(type);
  expect(new Set(ACTIVITY_TYPES).size).toBe(ACTIVITY_TYPES.length);
 });
 it('offers every type as a choice except the one only the Watch records',()=>{
  expect(CHOOSABLE_ACTIVITY_TYPES).not.toContain('Rope skipping');
  expect(CHOOSABLE_ACTIVITY_TYPES.filter(t=>t!=='Rope skipping')).toHaveLength(ACTIVITY_TYPES.length-1);
  expect(typesWithCurrent(CHOOSABLE_ACTIVITY_TYPES,'Rope skipping')).toContain('Rope skipping');
 });
 it('lets any type be classified, kept in metadata and sent as a change, so a saved activity can always be edited',()=>{
  for(const type of ACTIVITY_TYPES){
   const meta=emptyGrouping(OWNER);
   const next=changeGrouping(meta,{type:'classify',anchor:'a1',activity:type},{activities:[act(type)],owner:OWNER});
   expect(next.types.a1,type).toBe(type);
   // Reload from the server form: the type survives instead of being dropped as unknown.
   const sent=groupingChanges(meta,next);
   const stored=applyChanges(emptyGrouping(OWNER),sent);
   expect(stored.types.a1,type).toBe(type);
  }
 });
 it('rejects a type nothing records',()=>{
  expect(()=>changeGrouping(emptyGrouping(OWNER),{type:'classify',anchor:'a1',activity:'Underwater basket weaving'},{activities:[act('Walking')],owner:OWNER})).toThrow(/supported/);
 });
 it('keeps a saved Rope skipping activity editable: renamed, classified, and shown with its own type in the editor',()=>{
  const rope=act('Rope skipping');
  let meta=changeGrouping(emptyGrouping(OWNER),{type:'rename',anchor:'a1',title:'Morning skipping'},{activities:[rope],owner:OWNER});
  meta=changeGrouping(meta,{type:'classify',anchor:'a1',activity:'Rope skipping'},{activities:[rope],owner:OWNER});
  expect(meta.titles.a1).toBe('Morning skipping');expect(meta.types.a1).toBe('Rope skipping');
  const stored=applyChanges(emptyGrouping(OWNER),groupingChanges(emptyGrouping(OWNER),meta));
  expect(stored.titles.a1).toBe('Morning skipping');expect(stored.types.a1).toBe('Rope skipping');
  const editor=activityPresentation({...rope,details:{indoor:true}},{ownerID:OWNER}).editor;
  expect(editor.types.map(t=>t.value)).toContain('Rope skipping');
  expect(activityCapabilities('Rope skipping').gps).toBe(false);
 });
 it('lists the same types for an activity of any type in the editor, plus the current one',()=>{
  for(const type of ACTIVITY_TYPES){
   const values=activityPresentation(act(type),{ownerID:OWNER}).editor.types.map(t=>t.value);
   expect(values,type).toContain(type);
   expect(values).toEqual(expect.arrayContaining(CHOOSABLE_ACTIVITY_TYPES));
  }
 });
});
