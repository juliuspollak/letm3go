import { expect, it } from 'vitest';
import { sanitizeJPEG } from '../../supabase/functions/_shared/media.js';
it('removes EXIF before an image can reach shared storage',()=>{
 const jpeg=new Uint8Array([255,216,255,225,0,6,69,88,73,70,255,192,0,11,8,0,10,0,10,1,1,17,0,255,218,0,2,1,2,255,217]);
 const clean=sanitizeJPEG(jpeg);
 expect(new TextDecoder().decode(clean)).not.toContain('EXIF');
 expect(clean.length).toBeLessThan(jpeg.length);
});
it('rejects oversized, malformed and non-JPEG input',()=>{
 expect(()=>sanitizeJPEG(new Uint8Array(5_000_001))).toThrow();
 expect(()=>sanitizeJPEG(new Uint8Array([1,2,3]))).toThrow();
 expect(()=>sanitizeJPEG(new Uint8Array([255,216,255,225,255,255]))).toThrow();
});
