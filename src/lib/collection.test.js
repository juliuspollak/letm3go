import {describe,expect,it} from 'vitest';
import {
 COLLECTION_CATEGORIES,buildCollectionItem,categoryById,changeItemCategory,collectionItemError,equipmentActionLabel,
 equipmentForActivity,equipmentTripCount,equipmentUsage,isDerivedEquipment,itemCategory,itemDetail,itemTitle,normaliseCollectionItem,
 tripEquipment,tripEquipmentLabel,tripUsesEquipment
} from './collection.js';

const car={id:'car-1',name:'Geely',make:'Geely',model:'X3',category:'car',attributes:{powertrain:'Electric',year:'2021'}};
const bike={id:'bike-1',name:'Trek Marlin',make:'Trek',model:'Marlin 7',category:'bicycle',attributes:{style:'Mountain',year:'2020'}};
const kite={id:'kite-1',name:'Duotone 12',make:'Duotone',model:'Evo',category:'kite',attributes:{size:'12',style:'All-round'}};
const board={id:'board-1',name:'Twin tip',make:'Duotone',category:'board',attributes:{size:'138',style:'Twin tip'}};
const items=[car,bike,kite,board,{...car,id:'old-car',name:'Old car',archived:true,teslaVehicleID:'provider-car'}];
const trip=(patch)=>({id:'trip-1',activity:'Driving',source:'device',...patch});

describe('collection catalogue',()=>{
 it('keeps ids and attribute keys unique and safe for the native validator',()=>{
  const ids=COLLECTION_CATEGORIES.map(category=>category.id);
  expect(new Set(ids).size).toBe(ids.length);
  for(const category of COLLECTION_CATEGORIES){
   expect(category.id).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
   expect(category.label).toBeTruthy();
   const keys=category.fields.map(field=>field.key);
   expect(new Set(keys).size).toBe(keys.length);
   for(const key of keys)expect(key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  }
 });
 it('covers vehicles, cycling and kitesurfing equipment by activity',()=>{
  expect(equipmentForActivity(items,'Driving').map(item=>item.id)).toEqual(['car-1']);
  expect(equipmentForActivity(items,'Cycling').map(item=>item.id)).toEqual(['bike-1']);
  expect(equipmentForActivity(items,'Kitesurfing').map(item=>item.id)).toEqual(['kite-1','board-1']);
  expect(equipmentForActivity(items,'Walking')).toEqual([]);
  expect(equipmentForActivity(items,'Unknown').map(item=>item.id)).toEqual(['car-1','bike-1']);
  expect(equipmentActionLabel('Driving')).toBe('Add car');
  expect(equipmentActionLabel('Cycling')).toBe('Add bike');
  expect(equipmentActionLabel('Hiking')).toBeNull();
 });
 it('never offers an archived item, but still resolves it on an existing trip',()=>{
  expect(equipmentForActivity(items,'Driving').some(item=>item.id==='old-car')).toBe(false);
  expect(tripEquipment(trip({equipment:[{id:'old-car',name:'Old car'}]}),items)[0]).toMatchObject({id:'old-car',name:'Old car'});
 });
});

describe('item shape',()=>{
 it('names an item by its nickname, then brand and model, then category',()=>{
  expect(itemTitle(car)).toBe('Geely');
  expect(itemTitle({category:'car',make:'Kia',model:'EV6'})).toBe('Kia EV6');
  expect(itemTitle({category:'kite'})).toBe('Kite');
  expect(itemTitle({})).toBe('Car');
 });
 it('shows category fields with their units',()=>{
  expect(itemDetail(kite)).toBe('12 m² · All-round');
  expect(itemDetail(car)).toBe('Electric · 2021');
  expect(itemDetail(bike,1)).toBe('Mountain');
 });
 it('normalises legacy items without losing their details',()=>{
  const legacy=normaliseCollectionItem({id:'x',name:'Family car',make:'Kia',model:'EV6',source:'tesla',teslaVehicleID:'t1',attributes:{style:'ignored'}});
  expect(legacy).toMatchObject({category:'car',name:'Family car',make:'Kia',model:'EV6',source:'tesla',teslaVehicleID:'t1',attributes:{}});
  expect(itemCategory({})).toMatchObject({id:'car'});
 });
 it('stores only fields the chosen category understands',()=>{
  const built=buildCollectionItem({category:'car',name:'  Geely  ',make:'Geely',model:'X3',attributes:{powertrain:'Electric',registration:' abc123 ',year:'2021',size:'12',style:'Road'}});
  expect(built.name).toBe('Geely');
  expect(built.attributes).toEqual({powertrain:'Electric',registration:'ABC123',year:'2021'});
  expect(buildCollectionItem({category:'kite',attributes:{size:'12,5'}}).attributes.size).toBe('12.5');
  expect(buildCollectionItem({category:'kite',attributes:{size:'99'}}).attributes.size).toBeUndefined();
  expect(buildCollectionItem({category:'unknown-category'}).category).toBe('other');
  expect(buildCollectionItem({category:'bicycle'}).id).toBeTruthy();
 });
 it('requires a recognisable item and a small JPEG photo',()=>{
  expect(collectionItemError(buildCollectionItem({category:'car'}))).toMatch(/name, brand or model/);
  expect(collectionItemError(buildCollectionItem({category:'car',make:'Kia'}))).toBe('');
  expect(collectionItemError({category:'car',make:'Kia',photo:'data:image/png;base64,AAAA'})).toMatch(/smaller JPEG/);
  expect(collectionItemError({category:'car',make:'Kia',photo:`data:image/jpeg;base64,${'a'.repeat(180001)}`})).toMatch(/smaller JPEG/);
 });
 it('confirms exactly which attributes a category change would drop',()=>{
  const change=changeItemCategory({category:'car',attributes:{powertrain:'Petrol',year:'2019',colour:'Blue'}},'bicycle');
  expect(change.item.category).toBe('bicycle');
  expect(change.item.attributes).toEqual({year:'2019',colour:'Blue'});
  expect(change.removed).toEqual(['Powertrain']);
  expect(changeItemCategory({category:'car',attributes:{}},'kite').removed).toEqual([]);
  expect(categoryById('kite').fields.map(field=>field.key)).toEqual(['size','style']);
 });
});

describe('trip equipment resolution',()=>{
 it('uses the current Collection name and order from the stored list',()=>{
  const renamed=[{...car,name:'The Geely'}];
  expect(tripEquipment(trip({equipment:[{id:'car-1',name:'Geely'}]}),renamed)).toEqual([{id:'car-1',name:'The Geely',item:renamed[0],derived:false}]);
  expect(tripEquipment(trip({equipment:[{id:'kite-1',name:'Kite'},{id:'board-1',name:'Board'}]}),items).map(ref=>ref.name)).toEqual(['Duotone 12','Twin tip']);
  expect(tripEquipmentLabel(trip({equipment:[{id:'kite-1',name:'Kite'},{id:'board-1',name:'Board'}]}),items)).toBe('Duotone 12 + Twin tip');
 });
 it('falls back to the label saved with the trip when the item is gone',()=>{
  expect(tripEquipment(trip({equipment:[{id:'deleted',name:'Sold bike'}]}),items)).toEqual([{id:'deleted',name:'Sold bike',item:null,derived:true}]);
  expect(tripEquipment(trip({vehicleID:'deleted',vehicle:'Sold bike'}),items)[0].name).toBe('Sold bike');
 });
 it('reads assignments written before equipment lists existed',()=>{
  expect(tripEquipment(trip({vehicleID:'car-1',vehicle:'Geely'}),items).map(ref=>ref.id)).toEqual(['car-1']);
  expect(tripEquipment(trip({vehicle:'Kia'}),items).map(ref=>ref.name)).toEqual(['Kia']);
  expect(tripEquipment(trip({}),items)).toEqual([]);
 });
 it('resolves Tesla and reconciled journeys from the provider vehicle id only',()=>{
  const tesla={id:'tesla-1',activity:'Driving',source:'tesla',providerVehicleID:'provider-car'};
  expect(tripEquipment(tesla,items).map(ref=>ref.id)).toEqual(['old-car']);
  expect(isDerivedEquipment(tesla)).toBe(true);
  expect(tripEquipment({...tesla,providerVehicleID:'unknown'},items)).toEqual([]);
  expect(tripEquipment({...tesla,source:'combined'},items).map(ref=>ref.id)).toEqual(['old-car']);
  expect(isDerivedEquipment(trip({}))).toBe(false);
 });
 it('unions the equipment of a grouped journey without repeating it',()=>{
  const grouped={isGroupedJourney:true,segments:[{id:'a',equipment:[{id:'car-1',name:'Geely'}]},{id:'b',equipment:[{id:'car-1',name:'Geely'}]},{id:'c',equipment:[{id:'bike-1',name:'Trek'}]}]};
  expect(tripEquipment(grouped,items).map(ref=>ref.id)).toEqual(['car-1','bike-1']);
 });
 it('filters and counts only journeys that used the item',()=>{
  const driving=trip({id:'a',equipment:[{id:'car-1',name:'Geely'}]});
  const cycling={id:'b',activity:'Cycling',source:'device',equipment:[{id:'bike-1',name:'Trek Marlin'}]};
  const without={id:'c',activity:'Driving',source:'device'};
  expect(tripUsesEquipment(driving,items,'car-1')).toBe(true);
  expect(tripUsesEquipment(without,items,'car-1')).toBe(false);
  expect(equipmentTripCount([driving,cycling,without],items,'car-1')).toBe(1);
  expect(equipmentUsage([driving,cycling,without,{...driving,id:'d'}],items)).toEqual([{item:car,count:2},{item:bike,count:1}]);
 });
});

