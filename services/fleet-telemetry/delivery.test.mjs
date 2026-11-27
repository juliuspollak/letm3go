import {expect,it,vi} from 'vitest';
import {deliverFleetMessage} from './delivery.mjs';

const vin='5YJ3E1EA0KF000001';
const frame={
 topic:'letm3go_V',partition:1,message:{
  key:Buffer.from(vin),offset:'9007199254740993',
  value:Buffer.from(JSON.stringify({vin,createdAt:new Date().toISOString(),data:[{key:'Gear',value:{shiftStateValue:'ShiftStateD'}}]}))
 }
};

it('replays the same vehicle event after a crash between confirmed ingestion and committing the offset',async()=>{
 const send=vi.fn().mockResolvedValue(undefined),reject=vi.fn();
 const commit=vi.fn().mockRejectedValueOnce(new Error('consumer interrupted'));
 await expect(deliverFleetMessage(frame,{send,reject,commit})).rejects.toThrow('consumer interrupted');
 await deliverFleetMessage(frame,{send,reject,commit});
 expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
 expect(send.mock.calls[1][0].event.fields).toEqual({gear:'D'});
 expect(commit).toHaveBeenLastCalledWith([{topic:'letm3go_V',partition:1,offset:'9007199254740994'}]);
 expect(reject).not.toHaveBeenCalled();
});

it('retains the offset on ingestion failure and never copies rejected route data',async()=>{
 const send=vi.fn().mockRejectedValue(new Error('database unavailable')),reject=vi.fn(),commit=vi.fn();
 await expect(deliverFleetMessage(frame,{send,reject,commit})).rejects.toThrow('database unavailable');
 expect(commit).not.toHaveBeenCalled();
 await deliverFleetMessage({...frame,message:{...frame.message,value:Buffer.from('private malformed payload')}},{send,reject,commit});
 expect(reject).toHaveBeenCalledWith({reason:'invalid_receiver_frame',topic:frame.topic,partition:frame.partition,offset:frame.message.offset});
 expect(commit).toHaveBeenCalledOnce();
});
