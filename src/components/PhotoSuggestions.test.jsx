import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import PhotoSuggestions from './PhotoSuggestions.jsx';
afterEach(cleanup);

const at=(day,hour)=>Math.floor(Date.UTC(2026,10,day,hour)/1000);
const photo=(assetID,captureTime,extra={})=>({assetID,thumbnail:`data:image/jpeg;base64,${assetID}`,captureTime,...extra});

describe('photo suggestions',()=>{
 it('groups photos under the local day they were taken and names each tile',()=>{
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4)),photo('c',at(2,1))]} onImport={vi.fn()}/>);
  const days=screen.getAllByRole('heading',{level:3}).map(node=>node.textContent);
  expect(days).toHaveLength(2);
  expect(days[0]).not.toBe(days[1]);
  const boxes=screen.getAllByRole('checkbox',{name:/Suggested photo,/});
  expect(boxes).toHaveLength(3);
  expect(boxes[0]).toHaveAccessibleName(expect.stringContaining('not selected'));
 });
 it('imports only the photos the person selected and reports what happened',async()=>{
  const onImport=vi.fn().mockResolvedValue({ok:true});
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={onImport}/>);
  expect(screen.getByRole('button',{name:'Add Selected (0)'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Add Selected (2)'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('2 added'));
  expect(onImport.mock.calls.map(([assetID])=>assetID)).toEqual(['a','b']);
  // Imported photos leave the grid rather than sitting there as if nothing happened.
  await waitFor(()=>expect(screen.queryByRole('checkbox',{name:/Suggested photo,/})).not.toBeInTheDocument());
  // ...but a completed import is not the same as an empty library.
  expect(screen.getByText('All shown photos added.')).toBeInTheDocument();
  expect(screen.queryByText(/No photos from your library/)).not.toBeInTheDocument();
 });
 it('does not call a fully imported first page the end of the library',async()=>{
  const onImport=vi.fn().mockResolvedValue({ok:true});
  const onLoadMore=vi.fn();
  const onClose=vi.fn();
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} hasMore total={3} onLoadMore={onLoadMore} onClose={onClose} onImport={onImport}/>);
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  fireEvent.click(screen.getByRole('button',{name:'Add Selected (2)'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('2 added'));
  expect(screen.getByText('All shown photos added.')).toBeInTheDocument();
  expect(screen.queryByText(/No photos from your library/)).not.toBeInTheDocument();
  const more=screen.getByRole('button',{name:'Load more photos'});
  expect(more).toBeEnabled();
  expect(screen.getByRole('button',{name:'Cancel'})).toBeEnabled();
  fireEvent.click(more);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
 });
 it('imports under StrictMode instead of treating the development remount as a cancel',async()=>{
  const onImport=vi.fn().mockResolvedValue({ok:true});
  render(<StrictMode><PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={onImport}/></StrictMode>);
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  fireEvent.click(screen.getByRole('button',{name:'Add Selected (2)'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('2 added'));
  expect(onImport.mock.calls.map(([assetID])=>assetID)).toEqual(['a','b']);
 });

 it('keeps a failed photo selected so the retry acts only on the failure',async()=>{
  const onImport=vi.fn()
   .mockResolvedValueOnce({ok:true})
   .mockResolvedValueOnce({ok:false,message:'Photo is not available locally.'})
   .mockResolvedValueOnce({ok:true});
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={onImport}/>);
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  fireEvent.click(screen.getByRole('button',{name:'Add Selected (2)'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('1 added · 1 failed'));
  expect(screen.getByText(/Photo is not available locally\./)).toBeInTheDocument();
  onImport.mockClear();
  fireEvent.click(screen.getByRole('button',{name:'Retry 1 failed'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport).toHaveBeenCalledWith('b');
  // The successful first photo is still part of the batch, so a completed retry
  // reads "2 added", not "1 added" as if the earlier import had been undone.
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('2 added'));
 });
 it('keeps an iCloud-only candidate visible and says why it cannot import yet',()=>{
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),{assetID:'cloud',thumbnail:'',localAvailable:false,captureTime:at(1,4)}]} onImport={vi.fn()}/>);
  expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(2);
  expect(screen.getByText('In iCloud')).toBeInTheDocument();
  expect(screen.getByText(/Not downloaded\. Download it in Photos, then retry\./)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button',{name:/Preview suggested photo/})[1]);
  expect(screen.getByRole('dialog',{name:'Photo preview'})).toHaveTextContent(/This photo is in iCloud and has not been downloaded/);
 });
 it('hides a skipped photo until the person asks to revisit it, and can unskip it',async()=>{
  const onSkip=vi.fn().mockResolvedValue(true);
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onSkip={onSkip} onImport={vi.fn()}/>);
  fireEvent.click(screen.getAllByRole('button',{name:/^Skip suggested photo/})[0]);
  await waitFor(()=>expect(onSkip).toHaveBeenCalledWith('a',true));
  await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(1));
  fireEvent.click(screen.getByRole('checkbox',{name:'Show skipped photos'}));
  fireEvent.click(screen.getByRole('button',{name:/^Show suggested photo from .* again$/}));
  await waitFor(()=>expect(onSkip).toHaveBeenCalledWith('a',false));
  await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(2));
 });
 it('never offers a photo the activity already holds',()=>{
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} existing={[{assetID:'a'}]} onImport={vi.fn()}/>);
  expect(screen.getByText('Already with this activity: 1 photo.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
 });
 it('reconciles a selection when a refresh removes or skips a candidate',()=>{
  const {rerender}=render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
  // A concurrent import elsewhere removed b. The stale local key must not keep
  // the count or Add Selected referring to a photo that is no longer offered.
  rerender(<PhotoSuggestions suggestions={[photo('a',at(1,2))]} onImport={vi.fn()}/>);
  expect(screen.getByText('1 of 1 selected')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Add Selected (1)'})).toBeEnabled();
  // Skipping a selected candidate hides it; undoing the skip brings the original
  // selection back rather than forcing the person to pick it again.
  rerender(<PhotoSuggestions suggestions={[photo('a',at(1,2)),{...photo('b',at(1,4)),skipped:true}]} onImport={vi.fn()}/>);
  expect(screen.getByText('1 of 1 selected')).toBeInTheDocument();
  rerender(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={vi.fn()}/>);
  expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
 });
 it('selects only one day at a time and can clear that day again',()=>{
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4)),photo('c',at(2,1))]} onImport={vi.fn()}/>);
  const dayButtons=screen.getAllByRole('button',{name:'Select day'});
  expect(dayButtons).toHaveLength(2);
  fireEvent.click(dayButtons[0]);
  expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Clear day'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Clear day'}));
  expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
 });
 it('pages a large library instead of silently cutting the list off',()=>{
  const many=Array.from({length:30},(_,index)=>photo(`p${index}`,at(1,index%24)));
  const onLoadMore=vi.fn();
  render(<PhotoSuggestions suggestions={many} hasMore total={120} onLoadMore={onLoadMore} onImport={vi.fn()}/>);
  expect(screen.getByText(/Showing 30 of 120 photos/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Load more photos'}));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
 });
 it('reports the last page honestly once there is nothing more to load',()=>{
  const many=Array.from({length:30},(_,index)=>photo(`p${index}`,at(1,index%24)));
  render(<PhotoSuggestions suggestions={many} hasMore={false} total={45} onLoadMore={vi.fn()} onImport={vi.fn()}/>);
  expect(screen.getByText(/Showing 30 of 45 photos/)).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Load more photos'})).not.toBeInTheDocument();
 });
 it('explains an empty result without inventing candidates',()=>{
  render(<PhotoSuggestions suggestions={[]} onImport={vi.fn()}/>);
  expect(screen.getByText(/No photos from your library were captured/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox',{name:/Suggested photo,/})).not.toBeInTheDocument();
 });
 it('previews a photo full screen without losing the selection made in the grid',()=>{
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={vi.fn()}/>);
  fireEvent.click(screen.getAllByRole('checkbox',{name:/Suggested photo,/})[0]);
  expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button',{name:/Preview suggested photo/})[0]);
  const preview=screen.getByRole('dialog',{name:'Photo preview'});
  expect(preview).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Deselect photo'}));
  fireEvent.click(screen.getByRole('button',{name:'Done'}));
  expect(screen.queryByRole('dialog',{name:'Photo preview'})).not.toBeInTheDocument();
  expect(screen.getByText('0 of 2 selected')).toBeInTheDocument();
 });
it('moves focus into the preview, traps Tab within it and returns focus to the opener on close',()=>{
 render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={vi.fn()}/>);
 const opener=screen.getAllByRole('button',{name:/Preview suggested photo/})[0];
 opener.focus();
 fireEvent.click(opener);
 const dialog=screen.getByRole('dialog',{name:'Photo preview'});
 expect(screen.getByRole('button',{name:'Done'})).toHaveFocus();
 fireEvent.keyDown(dialog,{key:'Tab'});
 expect(screen.getByRole('button',{name:'Select photo'})).toHaveFocus();
 fireEvent.keyDown(dialog,{key:'Tab',shiftKey:true});
 expect(screen.getByRole('button',{name:'Done'})).toHaveFocus();
 fireEvent.keyDown(dialog,{key:'Escape'});
 expect(screen.queryByRole('dialog',{name:'Photo preview'})).not.toBeInTheDocument();
 expect(opener).toHaveFocus();
});
 it('offers an explicit cancel so leaving the suggestions is never ambiguous',()=>{
  const onClose=vi.fn();
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2))]} onClose={onClose} onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(onClose).toHaveBeenCalled();
 });
});

it('can cancel while the native import is busy and never starts the next photo',async()=>{
 const suggestions=[photo('first',at(1,2)),photo('second',at(1,3))];
 let finish;
 const onImport=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const onClose=vi.fn();
 const {rerender}=render(<PhotoSuggestions suggestions={suggestions} onImport={onImport} onClose={onClose}/>);
 for(const tile of screen.getAllByRole('checkbox',{name:/Suggested photo,/}))fireEvent.click(tile);
 fireEvent.click(screen.getByRole('button',{name:'Add Selected (2)'}));
 expect(onImport).toHaveBeenCalledTimes(1);
 rerender(<PhotoSuggestions suggestions={suggestions} onImport={onImport} onClose={onClose} busy/>);
 const cancel=screen.getByRole('button',{name:'Cancel import'});
 expect(cancel).toBeEnabled();
 fireEvent.click(cancel);
 await act(async()=>{finish({ok:true});});
 expect(onImport).toHaveBeenCalledTimes(1);
 expect(onClose).not.toHaveBeenCalled();
});
it('stops a batch when the account changes instead of importing every doomed photo',async()=>{
 const suggestions=[photo('first',at(1,2)),photo('second',at(1,3)),photo('third',at(1,4))];
 const onImport=vi.fn().mockResolvedValue({ok:false,message:'Account changed. Nothing was added.'});
 render(<PhotoSuggestions suggestions={suggestions} onImport={onImport}/>);
 fireEvent.click(screen.getByRole('button',{name:'Select all'}));
 fireEvent.click(screen.getByRole('button',{name:'Add Selected (3)'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('0 added · 2 cancelled · 1 failed'));
 expect(onImport).toHaveBeenCalledTimes(1);
 expect(screen.getByText((_,node)=>node.tagName==='LI'&&node.textContent.includes('Account changed. Nothing was added.'))).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Retry .* failed/})).not.toBeInTheDocument();
});
it('continues past a retryable local-library failure but stops after revoked permission',async()=>{
 const suggestions=[photo('a',at(1,2)),photo('b',at(1,3)),photo('c',at(1,4))];
 const onImport=vi.fn()
  .mockResolvedValueOnce({ok:false,message:'Photo is not available locally. Download it in Photos, then retry.'})
  .mockResolvedValueOnce({ok:false,message:'Photo access was not granted.'})
  .mockResolvedValue({ok:true});
 render(<PhotoSuggestions suggestions={suggestions} onImport={onImport}/>);
 fireEvent.click(screen.getByRole('button',{name:'Select all'}));
 fireEvent.click(screen.getByRole('button',{name:'Add Selected (3)'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('0 added · 1 cancelled · 2 failed'));
 // The local-availability failure is offered for a retry, the permission failure is not.
 expect(screen.getByRole('button',{name:'Retry 1 failed'})).toBeInTheDocument();
 expect(onImport).toHaveBeenCalledTimes(2);
});
it('does not offer already-added or skipped photos for selection in the preview',()=>{
 render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,3)),{...photo('c',at(1,4)),skipped:true}]} existing={[{assetID:'a'}]} onImport={vi.fn()}/>);
 fireEvent.click(screen.getAllByRole('button',{name:/Preview suggested photo/})[0]);
 expect(screen.getByRole('button',{name:'Already added'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Done'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Show skipped photos'}));
 fireEvent.click(screen.getAllByRole('button',{name:/Preview suggested photo/})[2]);
 expect(screen.getByRole('button',{name:'Skipped photo'})).toBeDisabled();
});
