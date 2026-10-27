import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import PersonAvatar from './PersonAvatar.jsx';
afterEach(cleanup);
it('shows the same labelled initial for members without a shared image',()=>{
 render(<PersonAvatar name="Majka"/>);
 expect(screen.getByRole('img',{name:'Majka avatar'})).toHaveTextContent('M');
});
it('resolves the signed-in user photo by stable id regardless of the name',()=>{
 const photo='data:image/jpeg;base64,AAAA';
 render(<PersonAvatar name="Julius" userId="self-id" selfId="self-id" selfAvatar={photo}/>);
 expect(screen.getByRole('img',{name:'Julius avatar'}).querySelector('img')).toHaveAttribute('src',photo);
});
it('uses the shared photo for that id when local preferences have none',()=>{
 const photo='data:image/jpeg;base64,BBBB';
 render(<PersonAvatar name="Julius" userId="SELF-ID" selfId="self-id" photos={{'self-id':photo}} selfAvatar={null}/>);
 expect(screen.getByRole('img',{name:'Julius avatar'}).querySelector('img')).toHaveAttribute('src',photo);
});
it('never borrows another person photo for the signed-in bubble',()=>{
 render(<PersonAvatar name="Julius" userId="self-id" selfId="self-id" photos={{other:'data:image/jpeg;base64,CCCC'}} selfAvatar={null}/>);
 expect(screen.getByRole('img',{name:'Julius avatar'})).toHaveTextContent('J');
});
it('swaps to an updated photo instead of keeping the old image',()=>{
 const first='data:image/jpeg;base64,AAAA',second='data:image/jpeg;base64,BBBB';
 const {rerender}=render(<PersonAvatar name="Julius" userId="self-id" selfId="self-id" selfAvatar={first}/>);
 rerender(<PersonAvatar name="Julius" userId="self-id" selfId="self-id" selfAvatar={second}/>);
 expect(screen.getByRole('img',{name:'Julius avatar'}).querySelector('img')).toHaveAttribute('src',second);
});
it('falls back when an allowed profile image fails to load',()=>{
 const photo='data:image/jpeg;base64,AAAA';
 const {rerender}=render(<PersonAvatar name="Julius" src={photo}/>);
 const avatar=screen.getByRole('img',{name:'Julius avatar'});
 fireEvent.error(avatar.querySelector('img'));
 expect(avatar).toHaveTextContent('J');
 rerender(<PersonAvatar name="Julius" src="data:image/jpeg;base64,BBBB"/>);
 expect(screen.getByRole('img',{name:'Julius avatar'}).querySelector('img')).toHaveAttribute('src','data:image/jpeg;base64,BBBB');
});

