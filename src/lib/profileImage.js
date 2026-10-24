export async function profileImage(file){
 if(!file.type.startsWith('image/')||file.size>20_000_000)throw new Error('Choose an image under 20 MB.');
 const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const side=Math.min(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);return canvas.toDataURL('image/jpeg',0.8);}finally{bitmap.close();}
}
