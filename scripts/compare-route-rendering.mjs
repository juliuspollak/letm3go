// Reproducible geometry evidence, entirely synthetic (no account/location data).
// node scripts/compare-route-rendering.mjs [--benchmark]
import {writeFileSync} from 'node:fs';
import {routeDensity,journeyEdges,edgePoints} from '../src/lib/routeDensity.js';
const origin=[-34.56,150.86],cos=Math.cos(origin[0]*Math.PI/180);
const at=(x,y)=>[origin[0]+y/111320,origin[1]+x/(111320*cos)];
const xy=p=>[(p[1]-origin[1])*111320*cos,(p[0]-origin[0])*111320];
const road=Array.from({length:501},(_,i)=>at(i*10,i*3));
const density=routeDensity([{id:'synthetic-straight',startedAt:1,routeSegments:[road]}]);
const deviation=points=>Math.max(0,...points.map(p=>{const [x,y]=xy(p);return Math.abs(y-.3*x)/Math.hypot(1,.3);}));
const metrics=density.levels.map(level=>({cellMetres:level.cell,beforeMaxLateralMetres:+deviation([...journeyEdges([road],level.cell)].flatMap(edge=>edgePoints(edge,level.cell))).toFixed(4),afterMaxLateralMetres:+deviation(level.buckets.flatMap(b=>b.lines.flat())).toFixed(4)}));
writeFileSync(new URL('../docs/gps-route-geometry-comparison.json',import.meta.url),JSON.stringify({fixture:'Synthetic 5 km straight line, slope 0.3, near Warilla latitude; not an actual recorded journey',metrics},null,2)+'\n');
const fine=density.levels.find(l=>l.cell===25);
const before=[...journeyEdges([road],25)].map(edge=>edgePoints(edge,25));
const after=fine.buckets.flatMap(b=>b.lines);
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="620" viewBox="0 0 1120 620"><rect width="1120" height="620" fill="#f5f7fa"/><g font-family="system-ui,sans-serif" fill="#16233b"><text x="28" y="34" font-size="22" font-weight="700">Grid counts must not become route geometry</text><text x="28" y="61" font-size="14">Synthetic straight GPS observations · 25 m density grid · same input before and after</text>';
function panel(lines,x,y,title,zoom){
 const scale=zoom?1.8:.46,range=zoom?250:1000,height=190,id=`clip-${x}-${y}`;
 svg+=`<text x="${x}" y="${y-12}" font-size="16" font-weight="650">${title}</text><rect x="${x}" y="${y}" width="510" height="${height}" rx="8" fill="white" stroke="#cbd5e1"/><clipPath id="${id}"><rect x="${x+5}" y="${y+5}" width="500" height="180"/></clipPath><g clip-path="url(#${id})">`;
 const path=line=>line.map((p,i)=>{const [px,py]=xy(p);return `${i?'L':'M'}${(x+18+px*scale).toFixed(2)},${(y+height-22-py*scale).toFixed(2)}`;}).join(' ');
 svg+=`<path d="${path([at(0,0),at(range,.3*range)])}" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4" fill="none"/>`;
 for(const line of lines)svg+=`<path d="${path(line)}" fill="none" stroke="${x<550?'#c84949':'#305ac6'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
 svg+='</g>';
}
panel(before,28,110,'Before: cell-centre drawing',false);panel(after,582,110,'After: observed traversal drawing',false);
panel(before,28,350,'Before: zoomed detail',true);panel(after,582,350,'After: zoomed detail',true);
svg+='<text x="28" y="575" font-size="14">Dashed grey: observed straight line. No road snapping, averaging or raw GPS edits.</text><text x="28" y="599" font-size="13">The JSON companion reports maximum lateral displacement at every density zoom band.</text></g></svg>\n';
writeFileSync(new URL('../docs/gps-route-geometry-comparison.svg',import.meta.url),svg);
console.log(JSON.stringify(metrics));
if(process.argv.includes('--benchmark')){
 const journeys=Array.from({length:300},(_,j)=>({id:`bench-${j}`,startedAt:j,routeSegments:[Array.from({length:1300},(_,i)=>[-34.56+i*.00001,150.86+j*.00001+Math.sin(i/60)*.0002])]}));
 const start=performance.now(),result=routeDensity(journeys);
 console.log(JSON.stringify({benchmark:'300 journeys / 390000 observations',milliseconds:Math.round(performance.now()-start),included:result.included,points:result.points,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)}));
}
