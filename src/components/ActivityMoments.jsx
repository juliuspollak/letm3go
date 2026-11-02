import {Camera,ImagePlus,Images} from 'lucide-react';
import PrivateImage from './PrivateImage.jsx';

// Photos are a primary part of an activity, not a footnote: the cover, the strip
// and the two entry points sit directly under the at-a-glance summary. Actions
// appear only for a locally owned activity; a read-only record still shows its
// photos without offering changes that the native side would refuse.
export default function ActivityMoments({trip,local=false,busy=false,adding=false,onPhoto,onAddPhotos,onFindPhotos}){
 const photos=Array.isArray(trip?.photos)?trip.photos:[];
 const cover=photos.find(photo=>photo.id===trip?.coverPhotoID)||null;
 const hero=cover?cover.url:trip?.cover||photos[0]?.url||null;
 const caption=cover?.caption||photos[0]?.caption||'Activity photo';
 // The picker is a long native call after it closes: keep the entry point visible
 // and describe what is happening instead of leaving a silently disabled button.
 const addLabel=adding?'Adding photos…':'Add photos';
 return <section className="activity-moments" aria-label="Moments and photos">
  <div className="activity-moments-head">
   <div>
    <p className="eyebrow">MOMENTS</p>
    <h2>{photos.length?`${photos.length} photo${photos.length===1?'':'s'}`:'Photos and memories'}</h2>
   </div>
   {local&&photos.length>0&&<div className="activity-moments-actions">
    <button type="button" className="primary" disabled={busy||adding} onClick={()=>onAddPhotos?.()}><ImagePlus size={17}/> {addLabel}</button>
    <button type="button" className="secondary" disabled={busy||adding} onClick={()=>onFindPhotos?.()}><Camera size={16}/> Find journey photos</button>
   </div>}
  </div>
  {hero
   ?<button type="button" className="activity-moments-cover" onClick={()=>onPhoto?.(trip,cover?.id||photos[0]?.id)} aria-label={`Open cover photo: ${caption}`}>
     <PrivateImage src={hero} alt={caption}/>
    </button>
   :<div className="activity-moments-empty">
     <Images size={22} aria-hidden="true"/>
     <p>{local?'Add photos from this activity to keep the day together.':'No photos were added to this activity.'}</p>
     {local&&<div className="activity-moments-actions">
      <button type="button" className="secondary" disabled={busy||adding} onClick={()=>onAddPhotos?.()}><ImagePlus size={17}/> {addLabel}</button>
      <button type="button" className="text-button" disabled={busy||adding} onClick={()=>onFindPhotos?.()}><Camera size={16}/> Find journey photos</button>
     </div>}
    </div>}
  {photos.length>1&&<div className="photo-strip" aria-label="Activity photos">
   {photos.filter(photo=>photo.id!==(cover?.id||photos[0]?.id)).map(photo=><button key={photo.id} type="button" onClick={()=>onPhoto?.(trip,photo.id)} aria-label={photo.caption?`Open photo: ${photo.caption}`:'Open photo'}><PrivateImage src={photo.url} alt={photo.caption}/></button>)}
  </div>}
  {local&&<p className="muted small-copy">Only selected photos are copied locally. No automatic uploads. Dashed map bubbles indicate timestamp-inferred locations.</p>}
 </section>;
}
