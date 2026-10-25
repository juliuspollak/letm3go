// Presentation-only conversions. All saved and recorded distances remain metric.
export const distanceUnits=[
 {value:'km',label:'Kilometres (km)'},
 {value:'mi',label:'Miles (mi)'},
 {value:'ft',label:'Feet (ft) · just for fun'},
];
export function distanceValue(km,unit='km'){
 const amount=Number(km)||0;
 const value=unit==='mi'?amount*0.6213711922:unit==='ft'?amount*3280.839895:amount;
 return new Intl.NumberFormat('en-AU',{maximumFractionDigits:unit==='ft'?0:value<10?1:0,minimumFractionDigits:unit==='ft'?0:value>0&&value<10?1:0}).format(value);
}
export const distanceUnitLabel=unit=>unit==='mi'?'mi':unit==='ft'?'ft':'km';
export const distanceText=(km,unit='km')=>`${distanceValue(km,unit)} ${distanceUnitLabel(unit)}`;
