// What the Social screens last loaded, kept for the life of the app so that opening one again shows it at once and refreshes it
// quietly, instead of starting from an empty screen and a spinner every time. Per account: the key always includes the user.
const store=new Map();
export const socialCache={
 get:key=>store.get(key),
 set:(key,value)=>{store.set(key,{...store.get(key),...value});},
 clear:()=>store.clear(),
};
