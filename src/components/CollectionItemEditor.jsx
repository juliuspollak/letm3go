import {useId,useState} from 'react';
import {ArrowLeft,Camera,X} from 'lucide-react';
import SwipeBack from './SwipeBack.jsx';
import CollectionIcon from './CollectionIcon.jsx';
import PrivateImage from './PrivateImage.jsx';
import {profileImage} from '../lib/profileImage.js';
import {COLLECTION_CATEGORIES,COLLECTION_PHOTO_LIMIT,brandOptions,buildCollectionItem,changeItemCategory,collectionItemError,itemCategory,normaliseCollectionItem} from '../lib/collection.js';

// Category is chosen first, then only that category's fields are shown. Values
// are kept in one flat map so switching category can report exactly what it
// would drop before anything is discarded.
function ChoiceField({field,value,onChange,disabled}){
 return <div className="collection-field" role="group" aria-labelledby={`${field.key}-label`}>
  <span className="collection-label" id={`${field.key}-label`}>{field.label}</span>
  <div className="collection-choices">
   {field.options.map(option=><button key={option} type="button" className="collection-choice" aria-pressed={value===option} aria-label={`${field.label}: ${option}`} disabled={disabled} onClick={()=>onChange(value===option?'':option)}>{option}</button>)}
  </div>
 </div>;
}

function NumberField({field,value,onChange,disabled}){
 return <label className="collection-field">{field.label}
  <span className="collection-number"><input type="number" inputMode="decimal" aria-label={field.label} value={value??''} min={field.min} max={field.max} step={field.step||1} placeholder={field.placeholder||''} disabled={disabled} onChange={event=>onChange(event.target.value)}/>{field.unit&&<span aria-hidden="true">{field.unit}</span>}</span>
 </label>;
}

function CollectionFields({category,values,setValues,brands,disabled}){
 const update=(patch)=>setValues(current=>({...current,...patch}));
 const updateAttribute=(key,value)=>setValues(current=>({...current,attributes:{...current.attributes,[key]:value}}));
 return <div className="collection-fields">
  <label>Name <span className="muted">(optional)</span><input name="name" value={values.name} maxLength={60} placeholder={category.id==='car'?'e.g. Geely':category.id==='bicycle'?'e.g. My Trek':category.id==='kite'?'e.g. Big kite':''} disabled={disabled} onChange={event=>update({name:event.target.value})}/></label>
  <label>Brand<input name="make" list={brands} value={values.make} maxLength={60} placeholder={category.id==='kite'?'e.g. Duotone':'e.g. Kia'} disabled={disabled} onChange={event=>update({make:event.target.value})}/></label>
  <datalist id={brands}>{brandOptions(category.id).map(brand=><option key={brand} value={brand}/>)}</datalist>
  <label>Model<input name="model" value={values.model} maxLength={60} placeholder="Optional" disabled={disabled} onChange={event=>update({model:event.target.value})}/></label>
  {category.fields.map(field=>field.kind==='choice'
   ?<ChoiceField key={field.key} field={field} value={values.attributes[field.key]||''} disabled={disabled} onChange={value=>updateAttribute(field.key,value)}/>
   :field.kind==='number'
    ?<NumberField key={field.key} field={field} value={values.attributes[field.key]} disabled={disabled} onChange={value=>updateAttribute(field.key,value)}/>
    :<label key={field.key} className="collection-field">{field.label}<input value={values.attributes[field.key]||''} maxLength={field.maxLength||60} placeholder={field.placeholder||''} disabled={disabled} onChange={event=>updateAttribute(field.key,field.uppercase?event.target.value.toUpperCase():event.target.value)}/></label>)}
 </div>;
}

function CollectionPhoto({photo,setPhoto,icon,label,disabled,busy,choosePhoto}){
 return <div className="collection-photo-field">
  <span className="collection-label">Photo <span className="muted">(optional)</span></span>
  <div className="collection-photo-row">
   {photo?<PrivateImage className="collection-photo" src={photo} alt={`${label||'Collection'} photo`}/>:<span className="collection-photo collection-photo-empty"><CollectionIcon icon={icon} size={24}/></span>}
   <div className="collection-photo-actions">
    <label className="secondary collection-photo-pick"><Camera size={16}/> {photo?'Change photo':'Add photo'}<input type="file" accept="image/*" aria-label="Collection item photo" disabled={disabled} onChange={choosePhoto}/></label>
    {photo&&<button type="button" className="text-button" disabled={disabled} onClick={()=>setPhoto(null)}><X size={15}/> Remove photo</button>}
    <small className="muted">{busy?'Preparing photo…':'Saved privately with this item.'}</small>
   </div>
  </div>
 </div>;
}

export default function CollectionItemEditor({item,onSave,onBack,saving=false,error=''}){
 const editing=Boolean(item?.id);
 // An item saved before categories existed edits as the car it defaulted to.
 const [categoryId,setCategoryId]=useState(()=>item?.category||(item?.id?itemCategory(item).id:null));
 const [values,setValues]=useState(()=>{const base=normaliseCollectionItem(item||{});return {name:base.name,make:base.make,model:base.model,attributes:{...base.attributes}};});
 const [photo,setPhoto]=useState(item?.photo||null);
 const [pending,setPending]=useState(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const brands=useId();
 const category=categoryId?COLLECTION_CATEGORIES.find(entry=>entry.id===categoryId):null;

 function chooseCategory(next){
  if(next===categoryId)return;
  const change=changeItemCategory({category:categoryId||'car',attributes:values.attributes},next);
  if(!change)return;
  if(change.removed.length){setPending({id:next,removed:change.removed});return;}
  setCategoryId(next);setValues(current=>({...current,attributes:change.item.attributes}));setPending(null);
 }
 function applyPending(){
  if(!pending)return;
  const change=changeItemCategory({category:categoryId||'car',attributes:values.attributes},pending.id);
  setCategoryId(pending.id);setValues(current=>({...current,attributes:change.item.attributes}));setPending(null);
 }
 async function choosePhoto(event){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  setBusy(true);setMessage('');
  try{
   const image=await profileImage(file);
   if(!image||image.length>COLLECTION_PHOTO_LIMIT)throw new Error('Choose a smaller JPEG photo for this item.');
   setPhoto(image);
  }catch(failure){setMessage(failure.message||'That photo could not be used.');}
  finally{setBusy(false);}
 }
 async function submit(event){
  event.preventDefault();setMessage('');
  if(!categoryId){setMessage('Choose a category first.');return;}
  const candidate=buildCollectionItem({...item,...values,category:categoryId,photo});
  const problem=collectionItemError(candidate);
  if(problem){setMessage(problem);return;}
  if(await onSave(candidate))onBack?.();
 }
 const disabled=saving||busy;
 return <SwipeBack onBack={()=>{if(!disabled)onBack?.();}}><section className="garage-view collection-editor">
  <button type="button" className="text-button" disabled={disabled} onClick={onBack}><ArrowLeft size={17}/> My Collection</button>
  <h2>{editing?'Collection item':'Add to your Collection'}</h2>
  <p className="muted small-copy">Choose a category, then add only what helps you recognise this item later.</p>
  <form onSubmit={submit}>
   <fieldset className="collection-category-fieldset">
    <legend>Category</legend>
    <div className="collection-category-grid" role="group" aria-label="Category">
     {COLLECTION_CATEGORIES.map(entry=><button key={entry.id} type="button" className="collection-category" aria-pressed={categoryId===entry.id} aria-label={entry.label} disabled={disabled} onClick={()=>chooseCategory(entry.id)}>
      <CollectionIcon icon={entry.icon} size={22}/><span>{entry.label}</span>
     </button>)}
    </div>
   </fieldset>
   {pending&&<div className="notice collection-category-change" role="status">
    <p>Changing to {COLLECTION_CATEGORIES.find(entry=>entry.id===pending.id)?.label} removes {pending.removed.join(', ')}.</p>
    <div className="detail-actions"><button type="button" className="secondary" onClick={()=>setPending(null)}>Keep {category?.label||'this category'}</button><button type="button" className="primary" onClick={applyPending}>Change category</button></div>
   </div>}
   {category?<CollectionFields category={category} values={values} setValues={setValues} brands={brands} disabled={disabled}/>:<p className="muted small-copy collection-category-hint">Select a category to see its details.</p>}
   <CollectionPhoto photo={photo} setPhoto={setPhoto} icon={category?.icon} label={values.name||values.make} disabled={disabled} busy={busy} choosePhoto={choosePhoto}/>
   <button type="submit" className="primary full" disabled={disabled||!categoryId}>{saving?'Saving…':editing?'Save item':'Add item'}</button>
  </form>
  {(message||error)&&<p role="alert" className="error">{message||error}</p>}
 </section></SwipeBack>;
}
