// Design review sheet for the build 44 motion identity. Open
// /design/motion-preview.html on the dev server (or on the iPhone simulator) to
// inspect the wordmark phases, navigation glyphs and record control states with
// the real components and the real stylesheet.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/styles.css';
import AnimatedWordmark from '../src/components/AnimatedWordmark.jsx';
import MobileNav from '../src/components/MobileNav.jsx';
import NavGlyph from '../src/components/NavGlyph.jsx';
import RecordControl from '../src/components/RecordControl.jsx';
import PersonAvatar from '../src/components/PersonAvatar.jsx';
import {MapPin,Moon} from 'lucide-react';

function demoAvatar(){
 try{
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=96;
  const context=canvas.getContext('2d');
  if(!context)return null;
  const gradient=context.createLinearGradient(0,0,96,96);
  gradient.addColorStop(0,'#4659d9');gradient.addColorStop(1,'#8fa4ff');
  context.fillStyle=gradient;context.fillRect(0,0,96,96);
  context.fillStyle='#ffffff';context.font='bold 46px DM Sans, sans-serif';
  context.fillText('J',32,64);
  return canvas.toDataURL('image/jpeg',0.85);
 }catch{return null;}
}

export function GlyphTaps(){
 const [pulse,setPulse]=useState(0);
 useEffect(()=>{
  const timer=window.setInterval(()=>setPulse(value=>value+1),2300);
  return()=>window.clearInterval(timer);
 },[]);
 return <div className="preview-glyphs">
  {['Home','Map','Trips','Social','Record'].map(name=><div key={name}><NavGlyph name={name} pulse={pulse} active={name==='Trips'}/><small>{name}</small></div>)}
 </div>;
}

export function Preview(){
 const avatar=useState(demoAvatar)[0];
 return <div className="app-shell">
  <header className="topbar" style={{padding:'0 21px'}}>
   <span className="mobile-brand"><AnimatedWordmark/></span>
   <div className="breadcrumb">Your world, a little closer.</div>
   <div className="top-actions">
    <button type="button" className="icon-button" aria-label="Toggle dark theme"><Moon size={20}/></button>
    <button type="button" className="icon-button presence-toggle presence-visible" aria-label="Location sharing"><MapPin size={20}/></button>
    <button type="button" className="avatar header-avatar" aria-label="Open profile"><PersonAvatar name="Julius" userId="self" selfId="self" selfAvatar={avatar} photos={{}} size="sm"/></button>
   </div>
  </header>
  <main>
   <section className="preview-card">
    <h2>Wordmark phases</h2>
    <p className="muted small-copy">The live header animates on its own. These are frozen frames of the same component at review size.</p>
    <div className="preview-wordmarks">
     {[['rest','Rest'],['bars','3 → lines'],['fold','Fold'],['compact','Compact'],['expand','Expand']].map(([phase,label])=><div key={phase}><span className="preview-wordmark"><AnimatedWordmark phase={phase}/></span><small>{label}</small></div>)}
    </div>
    <GlyphTaps/>
   </section>
   <section className="preview-card">
    <h2>Record control</h2>
    <div className="preview-records">
     {[['idle','Idle'],['recording','Recording'],['paused','Paused'],['auto','Automatic journey'],['starting','Starting']].map(([state,label])=><div key={state}><RecordControl state={state} label={label} variant="panel"/><small>{label}</small></div>)}
    </div>
   </section>
   <section className="preview-card">
    <h2>People</h2>
    <div className="people-bubbles">
     <div className="person-bubble"><PersonAvatar name="Julius" userId="self" selfId="self" selfAvatar={avatar} photos={{}} size="lg"/><strong>You</strong><small>Organiser</small></div>
     <div className="person-bubble"><PersonAvatar name="Majka" userId="other" selfId="self" photos={{}} size="lg"/><strong>Majka</strong><small>Member</small></div>
    </div>
   </section>
  </main>
  <MobileNav tab="Home" onSelect={()=>{}} recordState="recording"/>
 </div>;
}

createRoot(document.getElementById('root')).render(<Preview/>);
