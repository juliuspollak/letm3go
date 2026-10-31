// Feedback photos live in Supabase Storage, keyed `<owner>/<ticket>/<photo>.jpg`.
// Deleting the user cascades the database rows but never the objects, so they are
// listed from the bucket itself: that also finds photos with no attachment row.
export const FEEDBACK_BUCKET='feedback-attachments';
const PAGE=1000;
async function listed(bucket,folder){
 const names=[];
 for(let offset=0;;offset+=PAGE){
  const {data,error}=await bucket.list(folder,{limit:PAGE,offset});
  if(error)throw error;
  names.push(...(data||[]).map(item=>item.name));
  if((data||[]).length<PAGE)return names;
 }
}
export async function removeFeedbackObjects(storage,owner){
 const bucket=storage.from(FEEDBACK_BUCKET);
 const keys=[];
 for(const ticket of await listed(bucket,owner))for(const name of await listed(bucket,`${owner}/${ticket}`))keys.push(`${owner}/${ticket}/${name}`);
 for(let index=0;index<keys.length;index+=PAGE){
  const {error}=await bucket.remove(keys.slice(index,index+PAGE));
  if(error)throw error;
 }
 return keys.length;
}
