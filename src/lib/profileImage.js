export async function profileImage(file,{zoom=1,panX=0,panY=0}={}){
 if(!file.type.startsWith('image/')||file.size>20_000_000)throw new Error('Choose an image under 20 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const side=Math.min(bitmap.width,bitmap.height)/Math.max(1,Math.min(4,zoom));
  const dx=(bitmap.width-side)/2,dy=(bitmap.height-side)/2;
  const x=Math.max(0,Math.min(bitmap.width-side,dx+panX*dx));
  const y=Math.max(0,Math.min(bitmap.height-side,dy+panY*dy));
  canvas.getContext('2d').drawImage(bitmap,x,y,side,side,0,0,256,256);
  return canvas.toDataURL('image/jpeg',0.8);
 }finally{bitmap.close();}
}
