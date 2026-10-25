// Engineering estimate using public USD rates checked 25 October 2026.
// Assumes on-change reports reach the interval ceiling while driving/charging.
export function estimateFleetCost({drivingHours=60,chargingHours=30,awakeHours=90,drives=60,dataRequests=4,commands=2}={}){
 const signals=Math.ceil(drivingHours*(360+120+60)+awakeHours*12+chargingHours*12+drives*6);
 return {signals,streamingUSD:signals/150000,dataUSD:dataRequests/500,commandsUSD:commands/1000,wakesUSD:0,totalUSD:signals/150000+dataRequests/500+commands/1000};
}
