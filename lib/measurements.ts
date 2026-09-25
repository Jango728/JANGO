export function formatHeight(cm?:number){
 if(cm===undefined||!Number.isFinite(cm))return '—';
 const inches=Math.round(cm/2.54),feet=Math.floor(inches/12),rest=inches%12;
 return `${feet}′ ${rest}″`;
}
export function formatReach(cm?:number){
 if(cm===undefined||!Number.isFinite(cm))return '—';
 return `${Math.round(cm/2.54)}″`;
}
export function formatHeightDelta(cm:number){
 const inches=Math.round(Math.abs(cm)/2.54),feet=Math.floor(inches/12),rest=inches%12;
 return feet?`${feet}′ ${rest}″`:`${rest}″`;
}
export function formatReachDelta(cm:number){return `${Math.round(Math.abs(cm)/2.54)}″`;}
