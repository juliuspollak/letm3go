import {Accessibility,Bike,Car,CircleHelp,Compass,createLucideIcon,Dumbbell,Footprints,Mountain,MountainSnow,Waves} from 'lucide-react';

const JumpRope=createLucideIcon('JumpRope',[
 ['path',{d:'M5 8v6a7 7 0 0 0 14 0V8',key:'rope'}],
 ['rect',{x:3.5,y:2,width:3,height:6,rx:1,key:'left-handle'}],
 ['rect',{x:17.5,y:2,width:3,height:6,rx:1,key:'right-handle'}],
]);

const Running=createLucideIcon('Running',[
 ['circle',{cx:16,cy:4,r:2,key:'head'}],
 ['path',{d:'m5 10 4-4 5 2 2 4h4M14 8l-4 7 4 2 1 5m-5-7-4 4H3',key:'body'}],
]);

export const activityGlyphs={
 'figure.walk':Footprints,
 'figure.run':Running,
 'bicycle':Bike,
 'mountain.2':MountainSnow,
 'dumbbell':Dumbbell,
 'figure.strengthtraining.traditional':Dumbbell,
 'figure.pilates':Accessibility,
 'figure.jumprope':JumpRope,
 'car':Car,
 'figure.surfing':Waves,
 'figure.hiking':Mountain,
 'compass':Compass,
 'questionmark.circle':CircleHelp,
};
