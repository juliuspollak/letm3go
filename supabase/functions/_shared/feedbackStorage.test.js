import {expect,it,vi} from 'vitest';
import {removeFeedbackObjects} from './feedbackStorage.js';
function storage(files,{listError,removeError}={}){
 const removed=[];
 const bucket={
  list:vi.fn(async folder=>{
   if(listError)return {data:null,error:listError};
   const prefix=`${folder}/`,seen=new Set();
   for(const file of files)if(file.startsWith(prefix))seen.add(file.slice(prefix.length).split('/')[0]);
   return {data:[...seen].map(name=>({name})),error:null};
  }),
  remove:vi.fn(async keys=>{if(removeError)return {error:removeError};removed.push(...keys);return {error:null};}),
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
