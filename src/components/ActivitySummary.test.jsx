import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import ActivitySummary from './ActivitySummary.jsx';
afterEach(cleanup);

const trip={
 id:'t1',title:'Coogee to Bondi',activity:'walk',date:'2026-11-01',location:'Sydney',state:'finished',
 startedAt:Date.UTC(2026,10,1,1,0,0),finishedAt:Date.UTC(2026,10,1,2,30,0),
 distance:6.4,durationSeconds:5400,elevationGain:180,
 details:{heartRate:{summary:{average:128.4,maximum:161.2}}},
 photos:[{id:'p1'},{id:'p2'}]
};

describe('activity summary readout',()=>{
 it('shows the core numbers with units instead of a bare activity row',()=>{
  render(<ActivitySummary trip={trip} unit="km"/>);
  expect(screen.getByLabelText('Activity summary')).toBeInTheDocument();
  expect(screen.getByText('Distance')).toBeInTheDocument();
  expect(screen.getByText('6.4 km')).toBeInTheDocument();
  expect(screen.getByText('Time')).toBeInTheDocument();
  expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
  expect(screen.getByText('Elevation gain')).toBeInTheDocument();
  expect(screen.getByText('180 m')).toBeInTheDocument();
 });
 it('pairs the average heart rate with its peak so the number has context',()=>{
  render(<ActivitySummary trip={trip} unit="km"/>);
  expect(screen.getByText('Avg heart rate')).toBeInTheDocument();
  expect(screen.getByText('128 BPM')).toBeInTheDocument();
  expect(screen.getByText('Max 161 BPM')).toBeInTheDocument();
 });
 it('labels a moving time separately from the elapsed time when both exist',()=>{
  render(<ActivitySummary trip={{...trip,details:{...trip.details,movingSeconds:4800}}} unit="km"/>);
  expect(screen.getByText('Moving time').parentElement).toHaveTextContent('1 h 20 min');
  expect(screen.getByText('Elapsed time').parentElement).toHaveTextContent('1 h 30 min');
 });
 it('omits measurements the activity does not have rather than showing zeroes',()=>{
  render(<ActivitySummary trip={{...trip,durationSeconds:null,elevationGain:null,details:{}}} unit="km"/>);
  expect(screen.queryByText('Elevation gain')).not.toBeInTheDocument();
  expect(screen.queryByText('Avg heart rate')).not.toBeInTheDocument();
  expect(screen.queryByText('Time')).not.toBeInTheDocument();
  expect(screen.getByText('Distance')).toBeInTheDocument();
 });
});
