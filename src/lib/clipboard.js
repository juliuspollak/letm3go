// Some WebViews refuse the async clipboard API; a selected off-screen textarea
// still copies with the legacy command.
export async function copyText(text){
 try{await navigator.clipboard.writeText(text);return true;}
 catch{
  const area=document.createElement('textarea');
  area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
  document.body.appendChild(area);area.select();
  let copied;try{copied=document.execCommand('copy');}catch{copied=false;}
  area.remove();return copied;
 }
}
