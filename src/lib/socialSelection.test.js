import {expect,it} from 'vitest';
import {sharingSelection} from './socialSelection.js';
it('supports household and specific friends together',()=>{
 expect(sharingSelection({household:true,allFriends:false,selected:['a','b'],link:false})).toEqual({audience:'friends',mode:'mixed',recipients:['a','b']});
});
it('supports household only and all household + friends',()=>{
 expect(sharingSelection({household:true,allFriends:false,selected:[],link:false}).mode).toBe('household');
 expect(sharingSelection({household:true,allFriends:true,selected:[],link:false}).mode).toBe('all');
});
it('refuses to turn a private audience into a public link',()=>{
 expect(()=>sharingSelection({household:true,allFriends:false,selected:[],link:true})).toThrow();
 expect(()=>sharingSelection({household:false,allFriends:false,selected:[],link:false})).toThrow();
});
