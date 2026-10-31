import { useRef, useState } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, Trash2, AlertCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Camera as NativeCamera } from '@capacitor/camera';
import { MAX_ATTACHMENTS } from '../lib/feedback.js';
import { prepareFeedbackImage } from '../lib/feedbackImage.js';

// Photo evidence is optional. Everything is re-encoded to JPEG locally so EXIF
// orientation is baked in before anything leaves the device.
export default function FeedbackPhotos({ photos, onAdd, onRemove, onView, disabled = false, error = '' }) {
  const cameraInput = useRef(null);
  const libraryInput = useRef(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState('');
  const full = photos.length >= MAX_ATTACHMENTS;

  async function addFiles(files) {
    const room = MAX_ATTACHMENTS - photos.length;
    const picked = Array.from(files || []).slice(0, Math.max(0, room));
    if (!picked.length) return;
    setReading(true);
    setProblem('');
    const prepared = [];
    for (const file of picked) {
      try {
        const image = await prepareFeedbackImage(file);
        prepared.push({
          id: globalThis.crypto?.randomUUID?.() || `photo-${Date.now()}-${prepared.length}`,
          ...image,
          previewUrl: URL.createObjectURL(image.blob),
          status: 'ready',
          percent: 0,
        });
      } catch (caught) {
        setProblem(caught?.message || 'That photo could not be prepared. Try a screenshot or another image.');
      }
    }
    if (prepared.length) onAdd(prepared);
    setReading(false);
  }

  async function chooseFromLibrary() {
    if (disabled || full) return;
    setProblem('');
    if (!Capacitor.isNativePlatform()) { libraryInput.current?.click(); return; }
    setReading(true);
    try {
      const result = await NativeCamera.chooseFromGallery({
        allowMultipleSelection: true,
        limit: MAX_ATTACHMENTS - photos.length,
        quality: 82,
        targetWidth: 2048,
        targetHeight: 2048,
      });
      const files = [];
      for (const item of result.results || []) {
        const source = item.webPath || item.uri;
        if (!source) continue;
        try { files.push(await (await fetch(source)).blob()); } catch { /* Skip one unreadable item. */ }
      }
      await addFiles(files);
    } catch (caught) {
      if (!/cancel/i.test(caught?.message || '')) setProblem('The photo library could not be opened. You can still choose files below.');
    } finally {
      setReading(false);
    }
  }

  async function takePhoto() {
    if (disabled || full) return;
    setProblem('');
    if (!Capacitor.isNativePlatform()) { cameraInput.current?.click(); return; }
    setReading(true);
    try {
      const result = await NativeCamera.takePhoto({
        quality: 82,
        targetWidth: 2048,
        targetHeight: 2048,
        correctOrientation: true,
        saveToGallery: false,
      });
      const source = result.webPath || result.uri;
      if (!source) throw new Error('The camera did not return a photo.');
      await addFiles([await (await fetch(source)).blob()]);
    } catch (caught) {
      if (!/cancel/i.test(caught?.message || '')) setProblem('The camera is not available. Check camera permission or choose a photo from your library.');
    } finally {
      setReading(false);
    }
  }

  function pickFiles(event) {
    addFiles(event.target.files);
    event.target.value = '';
  }

  return (
    <section className="feedback-photos" aria-labelledby="feedback-photos-title">
      <div className="feedback-photos-head">
        <div>
          <strong id="feedback-photos-title">Screenshots or photos</strong>
          <p>Optional · up to {MAX_ATTACHMENTS} · saved privately</p>
        </div>
        <span aria-live="polite">{photos.length}/{MAX_ATTACHMENTS}</span>
      </div>
      {photos.length > 0 && (
        <ul className="feedback-photo-grid">
          {photos.map((photo, index) => (
            <li key={photo.id} className={`feedback-photo ${photo.status}`}>
              <button type="button" className="feedback-photo-open" onClick={() => onView(index)} aria-label={`View photo ${index + 1}`}>
                <img src={photo.previewUrl} alt={`Attachment ${index + 1}`} />
                {photo.status === 'uploading' && <span className="feedback-photo-progress" aria-hidden="true"><span style={{ width: `${photo.percent || 0}%` }} /></span>}
                {photo.status === 'uploaded' && <span className="feedback-photo-done" aria-label="Uploaded"><Check size={13} /></span>}
                {photo.status === 'failed' && <span className="feedback-photo-failed" aria-label="Upload failed"><AlertCircle size={14} /></span>}
              </button>
              <button type="button" className="feedback-photo-remove" onClick={() => onRemove(photo.id)} disabled={disabled} aria-label={`Remove photo ${index + 1}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="feedback-photo-actions">
        <button type="button" className="secondary" onClick={takePhoto} disabled={disabled || reading || full}>
          <Camera size={16} /> Take photo
        </button>
        <button type="button" className="secondary" onClick={chooseFromLibrary} disabled={disabled || reading || full}>
          <ImagePlus size={16} /> Choose photos
        </button>
        {reading && <span className="feedback-photo-reading" role="status"><LoaderCircle className="spin" size={15} /> Preparing…</span>}
      </div>
      {full && <p className="feedback-photo-note">You have added the maximum of {MAX_ATTACHMENTS} photos.</p>}
      {(problem || error) && <p className="error feedback-photo-problem" role="alert">{problem || error}</p>}
      <input ref={cameraInput} className="sr-only" type="file" accept="image/*" capture="environment" onChange={pickFiles} tabIndex={-1} aria-hidden="true" />
      <input ref={libraryInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={pickFiles} tabIndex={-1} aria-hidden="true" />
    </section>
  );
}
