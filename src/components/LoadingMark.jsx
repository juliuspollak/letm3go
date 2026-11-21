// The one loading indicator: the launch screen's spinning ring and glyph. By default it floats over the page, centred and
// above the content, so showing or hiding it never moves anything. Use `inline` only where it replaces a button's label.
// The words stay for screen readers.
const GLYPH=<svg className="boot-glyph" viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false"><path d="M5 22h3a8 8 0 0 0 8-8V6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="m10.5 11.5 5.5-5.5 5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export default function LoadingMark({label='Loading',inline=false}){
 const mark=<><span className="boot-ring" aria-hidden="true"/>{GLYPH}</>;
 return inline
  ?<span className="loading-mark loading-mark--inline" role="status" aria-label={label}>{mark}</span>
  :<div className="loading-overlay" role="status" aria-label={label}><div className="loading-mark loading-mark--page">{mark}</div></div>;
}
