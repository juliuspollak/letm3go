// Strip JPEG EXIF/IPTC/XMP segments; cap dimensions and reject unsupported images.
export function sanitizeJPEG(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(bytes.length>5_000_000||bytes[0]!==255||bytes[1]!==216)throw new Error('JPEG required, maximum 5 MB');
 const chunks=[bytes.slice(0,2)];let offset=2,dimensions=false;
 while(offset<bytes.length){
  if(bytes[offset]!==255)throw new Error('Invalid JPEG marker');
  const marker=bytes[offset+1];
  if(marker===218){if(!dimensions)throw new Error('Missing image dimensions');chunks.push(bytes.slice(offset));offset=bytes.length;break;}
  if(marker===217){chunks.push(bytes.slice(offset,offset+2));offset+=2;break;}
  const length=bytes[offset+2]*256+bytes[offset+3];
  if(length<2||offset+2+length>bytes.length)throw new Error('Invalid JPEG length');
  if([192,193,194].includes(marker)){
   const height=bytes[offset+5]*256+bytes[offset+6],width=bytes[offset+7]*256+bytes[offset+8];
   if(width<1||height<1||width>4096||height>4096)throw new Error('Image dimensions exceed limit');dimensions=true;
  }
  if(!(marker>=224&&marker<=239)&&marker!==254)chunks.push(bytes.slice(offset,offset+2+length));
  offset+=2+length;
 }
 if(!dimensions||offset!==bytes.length)throw new Error('Incomplete JPEG');
 const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let position=0;for(const c of chunks){result.set(c,position);position+=c.length;}return result;
}
export async function boundedJSON(request,maximum=7_000_000){
 const reader=request.body?.getReader();if(!reader)throw new Error('Body required');const chunks=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();throw new Error('Request too large');}chunks.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const value of chunks){all.set(value,offset);offset+=value.length;}return JSON.parse(new TextDecoder().decode(all));
}
