import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import PersonAvatar from './PersonAvatar.jsx';
afterEach(cleanup);
it('shows the same labelled initial for members without a shared image',()=>{
 render(<PersonAvatar name="Majka"/>);
 expect(screen.getByRole('img',{name:'Majka avatar'})).toHaveTextContent('M');
});
it('falls back when an allowed profile image fails to load',()=>{
 render(<PersonAvatar name="Julius" src="data:image/jpeg;base64,AAAA"/>);
 const avatar=screen.getByRole('img',{name:'Julius avatar'});
 fireEvent.error(avatar.querySelector('img'));
 expect(avatar).toHaveTextContent('J');
});
