import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
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
  expect(screen.getByRole('button',{name:'Select photos to add'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Add 2 photos'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('2 added'));
  expect(onImport.mock.calls.map(([assetID])=>assetID)).toEqual(['a','b']);
  // Imported photos leave the grid rather than sitting there as if nothing happened.
  await waitFor(()=>expect(screen.queryByRole('checkbox',{name:/Suggested photo,/})).not.toBeInTheDocument());
  expect(screen.getByText(/No photos from your library/)).toBeInTheDocument();
 });
 it('keeps a failed photo selected so the retry acts only on the failure',async()=>{
  const onImport=vi.fn()
   .mockResolvedValueOnce({ok:true})
   .mockResolvedValueOnce({ok:false,message:'Photo is not available locally.'});
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onImport={onImport}/>);
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  fireEvent.click(screen.getByRole('button',{name:'Add 2 photos'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('1 added · 1 failed'));
  expect(screen.getByText('Photo is not available locally.')).toBeInTheDocument();
  onImport.mockClear();
  fireEvent.click(screen.getByRole('button',{name:'Retry 1 failed'}));
  await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport).toHaveBeenCalledWith('b');
 });
 it('hides a skipped photo until the person asks to revisit it, and can unskip it',async()=>{
  const onSkip=vi.fn().mockResolvedValue(true);
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} onSkip={onSkip} onImport={vi.fn()}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Skip'})[0]);
  await waitFor(()=>expect(onSkip).toHaveBeenCalledWith('a',true));
  await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(1));
  fireEvent.click(screen.getByRole('checkbox',{name:'Show skipped photos'}));
  fireEvent.click(screen.getByRole('button',{name:'Show again'}));
  await waitFor(()=>expect(onSkip).toHaveBeenCalledWith('a',false));
  await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(2));
 });
 it('never offers a photo the activity already holds',()=>{
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2)),photo('b',at(1,4))]} existing={[{assetID:'a'}]} onImport={vi.fn()}/>);
  expect(screen.getByText('Already with this activity: 1 photo.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Select all'}));
  expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
 });
 it('says when the library search was bounded instead of implying it was exhaustive',()=>{
  const many=Array.from({length:30},(_,index)=>photo(`p${index}`,at(1,index%24)));
  render(<PhotoSuggestions suggestions={many} onImport={vi.fn()}/>);
  expect(screen.getByText(/Showing the first 30 photos/)).toBeInTheDocument();
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
 it('offers an explicit cancel so leaving the suggestions is never ambiguous',()=>{
  const onClose=vi.fn();
  render(<PhotoSuggestions suggestions={[photo('a',at(1,2))]} onClose={onClose} onImport={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(onClose).toHaveBeenCalled();
 });
});
