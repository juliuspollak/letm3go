import BrandMark from './BrandMark.jsx';
export default function AnimatedWordmark(){
 return <span className="animated-wordmark" role="img" aria-label="Letm3go"><span className="wordmark-motion" aria-hidden="true"><span className="wordmark-prefix">letm</span><span className="wordmark-three"><span className="wordmark-digit">3</span><svg className="wordmark-lines" viewBox="0 0 32 32" fill="none"><path d="M6 8h20M6 16h20M6 24h20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></span><span className="wordmark-suffix">go</span><span className="wordmark-arrow"><BrandMark/></span></span></span>;
}
