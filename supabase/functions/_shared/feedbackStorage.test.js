import {expect,it,vi} from 'vitest';
import {removeFeedbackObjects} from './feedbackStorage.js';
function storage(files,{listError,removeError,keep}={}){
 const removed=[];
 const bucket={
  list:vi.fn(async folder=>{
   if(listError)return {data:null,error:listError};
   const prefix=`${folder}/`,seen=new Set();
   for(const file of files)if(file.startsWith(prefix))seen.add(file.slice(prefix.length).split('/')[0]);
   return {data:[...seen].map(name=>({name})),error:null};
  }),
  remove:vi.fn(async keys=>{
   if(removeError)return {error:removeError};
   for(const key of keys){if(key===keep?.value)continue;removed.push(key);files.splice(files.indexOf(key),1);}
   return {error:null};
  }),
 };
 return {from:vi.fn(()=>bucket),removed};
}
it('removes every photo of the account, registered or not, and no one else\'s',async()=>{
 const s=storage(['a/t1/p1.jpg','a/t1/p2.jpg','a/t2/p3.jpg','b/t9/p9.jpg']);
 expect(await removeFeedbackObjects(s,'a')).toBe(3);
 expect(s.removed.sort()).toEqual(['a/t1/p1.jpg','a/t1/p2.jpg','a/t2/p3.jpg']);
});
it('does nothing for an account with no photos',async()=>{
 const s=storage([]);
 expect(await removeFeedbackObjects(s,'a')).toBe(0);
});
it('fails loudly, so account deletion stops and can be retried',async()=>{
 await expect(removeFeedbackObjects(storage(['a/t/p.jpg'],{listError:new Error('down')}),'a')).rejects.toThrow('down');
 await expect(removeFeedbackObjects(storage(['a/t/p.jpg'],{removeError:new Error('nope')}),'a')).rejects.toThrow('nope');
});
it('stops deletion when storage reports success but keeps a photo, and a retry finishes',async()=>{
 const keep={value:'a/t/p2.jpg'},s=storage(['a/t/p1.jpg','a/t/p2.jpg'],{keep});
 await expect(removeFeedbackObjects(s,'a')).rejects.toThrow('1 feedback photos remain');
 keep.value=null;
 await expect(removeFeedbackObjects(s,'a')).resolves.toBe(1);
 expect(s.removed.sort()).toEqual(['a/t/p1.jpg','a/t/p2.jpg']);
});
