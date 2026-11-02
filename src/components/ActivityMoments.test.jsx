import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ActivityMoments from './ActivityMoments.jsx';
afterEach(cleanup);
const trip={
 id:'ride',
 coverPhotoID:'photo-2',
 photos:[
  {id:'photo-1',url:'data:image/jpeg;base64,one',caption:'Creek crossing',locationSource:'capture time'},
  {id:'photo-2',url:'data:image/jpeg;base64,two',caption:'Lookout',locationSource:'photo location'}
 ]
};

it('leads with the cover photo and the number of moments',()=>{
 render(<ActivityMoments trip={trip} local onPhoto={vi.fn()}/>);
 expect(screen.getByRole('heading',{name:'2 photos'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Open cover photo: Lookout'})).toBeInTheDocument();
 expect(screen.getByLabelText('Activity photos')).toBeInTheDocument();
});

it('opens a photo from the strip so the gallery and the map stay coherent',()=>{
 const onPhoto=vi.fn();
 render(<ActivityMoments trip={trip} local onPhoto={onPhoto}/>);
 fireEvent.click(screen.getByRole('button',{name:'Open photo: Creek crossing'}));
 expect(onPhoto).toHaveBeenCalledWith(trip,'photo-1');
});

it('offers one-tap adding in the empty state instead of a blank space',()=>{
 const onAddPhotos=vi.fn();
 render(<ActivityMoments trip={{id:'hike',photos:[]}} local onAddPhotos={onAddPhotos}/>);
 expect(screen.getByText('Add photos from this activity to keep the day together.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Add photos'}));
 expect(onAddPhotos).toHaveBeenCalled();
});

it('explains an empty gallery honestly when the activity is read-only',()=>{
 render(<ActivityMoments trip={{id:'hike',photos:[]}}/>);
 expect(screen.getByText('No photos were added to this activity.')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Add photos'})).not.toBeInTheDocument();
});

it('never offers photo changes for an activity this device does not own',()=>{
 render(<ActivityMoments trip={trip}/>);
 expect(screen.queryByRole('button',{name:'Add photos'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Find journey photos'})).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'2 photos'})).toBeInTheDocument();
});
