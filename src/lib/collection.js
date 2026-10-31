import {newUUID} from './uuid.js';
// Collections are the equipment a person already owns. Items stay in the
// existing device-local Collection (preferences.vehicles) so offline recording,
// Household vehicle sharing and Tesla imports keep one source of truth.
//
// Category-specific information lives in a flat `attributes` map instead of a
// nullable column per equipment type: only this catalogue changes when a new
// category arrives, and the native preference validator accepts any short
// category slug. Old items without attributes remain valid.
const COLLECTION_ATTRIBUTE_LIMITS={count:24,key:32,value:120};
export const COLLECTION_PHOTO_LIMIT=180000;

const year={key:'year',label:'Year',kind:'number',min:1900,max:2100,step:1,placeholder:'Optional'};
const registration={key:'registration',label:'Registration',kind:'text',maxLength:20,uppercase:true,placeholder:'Optional'};
const colour={key:'colour',label:'Colour',kind:'text',maxLength:30,placeholder:'Optional'};

export const COLLECTION_CATEGORIES=[
 {id:'car',label:'Car',short:'car',icon:'car',fields:[
  {key:'powertrain',label:'Powertrain',kind:'choice',options:['Petrol','Diesel','Hybrid','PHEV','Electric']},
  year,registration,colour]},
 {id:'motorcycle',label:'Motorcycle',short:'motorcycle',icon:'car',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Road','Adventure','Cruiser','Scooter','Dirt','Other']},
  year,registration,colour]},
 {id:'bicycle',label:'Bicycle',short:'bike',icon:'bicycle',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Road','Mountain','Gravel','Hybrid','eBike','Other']},
  year,colour]},
 {id:'ebike',label:'E-bike',short:'e-bike',icon:'bicycle',fields:[
  {key:'style',label:'Type',kind:'choice',options:['City','Cargo','Mountain','Road','Folding','Other']},
  year,colour]},
 {id:'kite',label:'Kite',short:'kite',icon:'kite',fields:[
  {key:'size',label:'Size',kind:'number',unit:'m²',min:1,max:30,step:0.5,placeholder:'9'},
  {key:'style',label:'Type',kind:'choice',options:['All-round','Wave','Freestyle','Race','Foil','Other']}]},
 {id:'board',label:'Kiteboard',short:'board',icon:'board',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Twin tip','Directional','Foil board','Surfboard','Other']},
  {key:'size',label:'Length',kind:'number',unit:'cm',min:90,max:220,step:1,placeholder:'138'}]},
 {id:'surfboard',label:'Surfboard',short:'surfboard',icon:'board',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Shortboard','Longboard','Fish','Funboard','Other']},
  {key:'size',label:'Length',kind:'number',unit:'ft',min:3,max:14,step:1,placeholder:'6'}]},
 {id:'skis',label:'Skis',short:'skis',icon:'skis',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Alpine','Touring','Cross-country','Other']},
  {key:'size',label:'Length',kind:'number',unit:'cm',min:100,max:220,step:1,placeholder:'170'},year]},
 {id:'snowboard',label:'Snowboard',short:'snowboard',icon:'snowboard',fields:[
  {key:'style',label:'Type',kind:'choice',options:['All-mountain','Freestyle','Freeride','Splitboard','Other']},
  {key:'size',label:'Length',kind:'number',unit:'cm',min:100,max:180,step:1,placeholder:'156'},year]},
 {id:'boat',label:'Boat',short:'boat',icon:'boat',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Sail','Motor','Kayak','Canoe','Paddleboard','Other']},
  {key:'size',label:'Length',kind:'number',unit:'m',min:1,max:40,step:0.1,placeholder:'6.5'},registration]},
 {id:'camper',label:'Camper',short:'camper',icon:'camper',fields:[
  {key:'style',label:'Type',kind:'choice',options:['Campervan','Motorhome','Caravan','Trailer','Other']},
  year,registration]},
 {id:'other',label:'Other',short:'equipment',icon:'other',fields:[]}
];


// Activity families choose which Collection categories may be offered. Walking,
// running and hiking have no sensible equipment, so their cards stay clean.
const ACTIVITY_EQUIPMENT={
 Driving:['car','motorcycle'],
 Cycling:['bicycle','ebike'],
 'Road cycling':['bicycle','ebike'],
 MTB:['bicycle','ebike'],
 Kitesurfing:['kite','board','surfboard'],
 Unknown:['car','motorcycle','bicycle','ebike']
};

// Brand suggestions stay short and searchable; any other brand can be typed.
const BRANDS={
 car:['Audi','BMW','BYD','Chery','Citroën','Cupra','Dacia','Fiat','Ford','Geely','Genesis','GWM','Honda','Hyundai','Isuzu','Jeep','Kia','Land Rover','Lexus','Mazda','Mercedes-Benz','MG','Mini','Mitsubishi','Nissan','Peugeot','Polestar','Porsche','Renault','Seat','Skoda','Subaru','Suzuki','Tesla','Toyota','Volkswagen','Volvo'],
 motorcycle:['Aprilia','BMW','Can-Am','Ducati','Harley-Davidson','Honda','Husqvarna','Indian','Kawasaki','KTM','Moto Guzzi','Royal Enfield','Suzuki','Triumph','Yamaha','Zero'],
 bicycle:['Bianchi','BMC','Brompton','Canyon','Cannondale','Cube','Focus','Giant','Kona','Liv','Merida','Norco','Orbea','Rocky Mountain','Rose','Santa Cruz','Scott','Specialized','Tern','Trek','Vitus'],
 ebike:['Brompton','Cannondale','Cowboy','Cube','Giant','Haibike','Rad Power','Riese & Müller','Specialized','Tern','Trek','VanMoof'],
 kite:['Airush','Best','Cabrinha','Core','Duotone','Eleveight','F-One','Gong','Naish','North','Ozone','Reedin','RRD','Slingshot','Takoon'],
 board:['Cabrinha','Core','Duotone','F-One','Lieuwe','Naish','North','Slingshot'],
 surfboard:['Al Merrick','Firewire','JS Industries','Pyzel','Rip Curl','Torq'],
 skis:['Atomic','Black Crows','Blizzard','Dynastar','Fischer','Head','K2','Nordica','Rossignol','Salomon','Völkl'],
 snowboard:['Arbor','Bataleon','Burton','Capita','GNU','Jones','K2','Lib Tech','Nitro','Ride','Salomon','Yes'],
 boat:['Beneteau','Hobie','Jeanneau','Quicksilver','Sea Ray','Zodiac'],
 camper:['Adria','Bailey','Bürstner','Hobby','Hymer','Knaus','Swift','Volkswagen','Winnebago']
};

export function categoryById(id){
 return COLLECTION_CATEGORIES.find(category=>category.id===id)||null;
}

// Legacy manual items were created before categories were required and defaulted
// to a car, so an absent category keeps that behaviour instead of inventing one.
export function itemCategory(item){
 return categoryById(item?.category)||categoryById('car');
}

export function itemTitle(item){
 const name=String(item?.name||'').trim();
 if(name)return name;
 const brandModel=[item?.make,item?.model].map(value=>String(value||'').trim()).filter(Boolean).join(' ');
 return brandModel||itemCategory(item).label;
}

function attributeValue(field,value){
 const text=String(value??'').trim();
 if(!text)return '';
 if(field.kind==='number')return `${text}${field.unit?' '+field.unit:''}`;
 return text;
}

// Secondary line used on chips, sheets and Collection rows: category fields in
// catalogue order, never more than three fragments.
export function itemDetail(item,limit=2){
 const category=itemCategory(item);
 return category.fields.map(field=>attributeValue(field,item?.attributes?.[field.key])).filter(Boolean).slice(0,limit).join(' · ');
}

export function brandOptions(categoryId){
 return BRANDS[categoryId]||[];
}

export function categoriesForActivity(activity){
 return (ACTIVITY_EQUIPMENT[activity]||[]).map(categoryById).filter(Boolean);
}

// The first compatible category names the empty-state action ("Add car").
export function equipmentActionLabel(activity){
 const [first]=categoriesForActivity(activity);
 return first?`Add ${first.short}`:null;
}

// Archived items stay out of every picker but keep their existing trip labels.
// The activity's own category order decides relevance (the kite before the
// board), then names keep the list predictable.
export function equipmentForActivity(items,activity){
 const categories=ACTIVITY_EQUIPMENT[activity]||[];
 if(!categories.length)return [];
 return (items||[])
  .filter(item=>item&&!item.archived&&categories.includes(itemCategory(item).id))
  .sort((a,b)=>categories.indexOf(itemCategory(a).id)-categories.indexOf(itemCategory(b).id)||itemTitle(a).localeCompare(itemTitle(b)));
}

export function normaliseCollectionItem(item){
 const category=itemCategory(item);
 const attributes={};
 for(const field of category.fields){
  const value=item?.attributes?.[field.key];
  if(value!=null&&String(value).trim())attributes[field.key]=String(value).trim();
 }
 return {...item,source:item?.source||'manual',category:category.id,name:String(item?.name||'').trim(),
  make:String(item?.make||'').trim(),model:String(item?.model||'').trim(),archived:item?.archived===true,attributes};
}

// Store only what the chosen category understands, with the same limits the
// native preference file enforces.
export function buildCollectionItem(draft){
 const category=categoryById(draft?.category)||categoryById('other');
 const attributes={};
 for(const field of category.fields){
  const raw=draft?.attributes?.[field.key];
  if(raw==null||String(raw).trim()==='')continue;
  let value=String(raw).trim();
  if(field.kind==='number'){
   const number=Number(value.replace(',','.'));
   if(!Number.isFinite(number)||number<=0)continue;
   if(field.min!=null&&number<field.min)continue;
   if(field.max!=null&&number>field.max)continue;
   value=String(number);
  }else{
   if(field.uppercase)value=value.toUpperCase();
   if(field.options&&!field.options.includes(value))continue;
   if(field.maxLength&&value.length>field.maxLength)value=value.slice(0,field.maxLength);
  }
  if(value.length>COLLECTION_ATTRIBUTE_LIMITS.value)continue;
  if(Object.keys(attributes).length>=COLLECTION_ATTRIBUTE_LIMITS.count)break;
  attributes[field.key]=value;
 }
 const clean=value=>String(value||'').trim().slice(0,60);
 return {...draft,id:draft?.id||newUUID(),source:draft?.source||'manual',category:category.id,
  name:clean(draft?.name),make:clean(draft?.make),model:clean(draft?.model),archived:draft?.archived===true,attributes};
}

export function collectionItemError(item){
 if(!item?.name&&!item?.make&&!item?.model)return 'Add a name, brand or model so this item is recognisable.';
 if(item?.photo&&(!/^data:image\/jpeg;base64,/.test(item.photo)||item.photo.length>COLLECTION_PHOTO_LIMIT))return 'Choose a smaller JPEG photo for this item.';
 return '';
}

export function attributeLabel(categoryId,key){
 const field=categoryById(categoryId)?.fields.find(entry=>entry.key===key);
 return field?field.label:key;
}

// A value only survives a category change when the new category can still
// interpret it; "All-round" is a kite type, not a bicycle type.
function valueFitsField(field,value){
 const text=String(value??'').trim();
 if(!text)return false;
 if(field.kind==='number'){
  const number=Number(text.replace(',','.'));
  return Number.isFinite(number)&&number>0&&(field.min==null||number>=field.min)&&(field.max==null||number<=field.max);
 }
 if(field.options)return field.options.includes(text);
 return !field.maxLength||text.length<=field.maxLength;
}

// Changing category keeps compatible attributes and reports exactly what would
// be dropped, so the editor can confirm before discarding anything.
export function changeItemCategory(item,categoryId){
 const category=categoryById(categoryId);
 if(!category)return null;
 const kept={},removed=[];
 for(const [key,value] of Object.entries(item?.attributes||{})){
  const field=category.fields.find(entry=>entry.key===key);
  if(field&&valueFitsField(field,value))kept[key]=value;
  else if(String(value||'').trim())removed.push(attributeLabel(itemCategory(item).id,key));
 }
 return {item:{...item,category:category.id,attributes:kept},removed};
}

function resolveItem(items,id){
 if(id==null||id==='')return null;
 const key=String(id);
 return (items||[]).find(item=>String(item?.id)===key)||null;
}

// One resolver for every surface. Tesla and combined journeys carry a stable
// provider vehicle id, never a guess, and are matched to the imported item.
// Device recordings store an ordered list; the legacy single vehicle stays as
// the first entry so Household sharing and source reconciliation are unchanged.
export function tripEquipment(trip,items=[]){
 if(!trip)return [];
 if(trip.isGroupedJourney){
  const seen=new Set();
  return (trip.segments||[]).flatMap(segment=>tripEquipment(segment,items))
   .filter(ref=>{if(!ref.id||seen.has(String(ref.id)))return false;seen.add(String(ref.id));return true;});
 }
 if(trip.source==='tesla'||trip.source==='combined'){
  const provider=trip.providerVehicleID;
  if(!provider)return [];
  const item=(items||[]).find(candidate=>candidate?.teslaVehicleID&&String(candidate.teslaVehicleID)===String(provider));
  return item?[{id:String(item.id),name:itemTitle(item),item,derived:true}]:[];
 }
 const stored=Array.isArray(trip.equipment)?trip.equipment:[];
 const refs=stored.filter(ref=>ref&&typeof ref.id==='string'&&ref.id).map(ref=>{
  const item=resolveItem(items,ref.id);
  return {id:String(ref.id),name:item?itemTitle(item):String(ref.name||trip.vehicle||'Equipment'),item,derived:!item};
 });
 if(refs.length)return refs;
 // Assignments written before equipment lists existed.
 if(trip.vehicleID||trip.vehicle){
  const item=resolveItem(items,trip.vehicleID);
  return [{id:trip.vehicleID?String(trip.vehicleID):'',name:item?itemTitle(item):String(trip.vehicle||'Equipment'),item,derived:!item}];
 }
 return [];
}

export function tripEquipmentIDs(trip,items=[]){
 return tripEquipment(trip,items).map(ref=>ref.id).filter(Boolean);
}

// Tesla (and reconciled Tesla) journeys take their vehicle from the car, so
// their equipment is read-only and never written by a client.
export function isDerivedEquipment(trip){
 return trip?.source==='tesla'||trip?.source==='combined';
}

export function tripEquipmentLabel(trip,items=[]){
 return tripEquipment(trip,items).map(ref=>ref.name).join(' + ');
}

export function tripUsesEquipment(trip,items,itemId){
 if(itemId==null||itemId==='')return false;
 return tripEquipmentIDs(trip,items).some(id=>String(id)===String(itemId));
}

// Counts are derived from the journeys already in memory, so they cannot drift
// from what the Trips filter will show.
export function equipmentUsage(trips,items=[]){
 const counts=new Map();
 for(const trip of trips||[])for(const id of tripEquipmentIDs(trip,items))counts.set(String(id),(counts.get(String(id))||0)+1);
 return (items||[]).map(item=>({item,count:counts.get(String(item?.id))||0}))
  .filter(entry=>entry.count>0)
  .sort((a,b)=>b.count-a.count||itemTitle(a.item).localeCompare(itemTitle(b.item)));
}

export function equipmentTripCount(trips,items,itemId){
 return (trips||[]).reduce((count,trip)=>count+(tripUsesEquipment(trip,items,itemId)?1:0),0);
}

