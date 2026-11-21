import {useId,useLayoutEffect,useSyncExternalStore} from 'react';
// The one loading indicator: the launch screen's spinning ring and glyph. By default it floats over the page, centred and
// above the content, so showing or hiding it never moves anything. Use `inline` only where it replaces a button's label.
// The words stay for screen readers.
//
// Any number of components may ask for it at once (a list and the household behind it, say). Only the earliest one that is
// still mounted draws, and only it is announced, so there is never a stack of spinners or a repeated announcement.
const active=[];
const listeners=new Set();
const publish=()=>{for(const listener of listeners)listener();};
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const leader=()=>active[0]??null;
const GLYPH=<svg className="boot-glyph" viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false"><path d="M5 22h3a8 8 0 0 0 8-8V6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="m10.5 11.5 5.5-5.5 5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export default function LoadingMark({label='Loading',inline=false}){
 const id=useId();
 // Registered before the first paint (a layout effect), so two marks asked for in the same render can never both be drawn.
 useLayoutEffect(()=>{if(inline)return undefined;active.push(id);publish();return()=>{const at=active.indexOf(id);if(at>=0)active.splice(at,1);publish();};},[id,inline]);
 const first=useSyncExternalStore(subscribe,leader,leader);
 const mark=<><span className="boot-ring" aria-hidden="true"/>{GLYPH}</>;
 if(inline)return <span className="loading-mark loading-mark--inline" role="status" aria-label={label}>{mark}</span>;
 // Nothing draws until a mark is the registered leader, which happens before the screen is painted.
 if(first!==id)return null;
 return <div className="loading-overlay" role="status" aria-label={label}><div className="loading-mark loading-mark--page">{mark}</div></div>;
}
