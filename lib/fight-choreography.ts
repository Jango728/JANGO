import type {FinishMethod} from './finish';
export type V=[number,number,number];
export const JOINTS=['head','neck','chest','pelvis','ls','le','lw','rs','re','rw','lh','lk','lf','rh','rk','rf'] as const;
export type Joint=typeof JOINTS[number];
export type Pose=Record<Joint,V>;
export type Actor={position:V;yaw:number;pose:Pose;gesture?:number};
export const SCENE_LENGTH=10;
export const ease=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10)};
const ramp=(t:number,a:number,b:number)=>ease((t-a)/(b-a));
const pulse=(t:number,a:number,b:number)=>t<a||t>b?0:Math.sin(Math.PI*(t-a)/(b-a))**2;
const mix=(a:V,b:V,t:number):V=>a.map((x,i)=>x+(b[i]-x)*t) as V;
export function blend(a:Pose,b:Pose,t:number):Pose{return Object.fromEntries(JOINTS.map(k=>[k,mix(a[k],b[k],t)])) as Pose}
export function standing():Pose{return {head:[0,1.79,.03],neck:[0,1.58,0],chest:[0,1.36,0],pelvis:[0,.94,0],ls:[-.25,1.47,0],le:[-.34,1.18,.12],lw:[-.21,1.57,.31],rs:[.25,1.47,0],re:[.34,1.18,.12],rw:[.21,1.53,.33],lh:[-.13,.9,0],lk:[-.21,.49,.12],lf:[-.23,.08,.26],rh:[.13,.9,0],rk:[.22,.49,-.12],rf:[.23,.08,-.23]}}
function guard(t:number,duck=0,slip=0):Pose{
 const p=standing(),bob=Math.sin(t*8)*.025;
 for(const k of JOINTS){if(k!=='lf'&&k!=='rf'){p[k][1]+=bob-duck*(k==='lk'||k==='rk'?.1:.28);if(!['lk','rk','lh','rh','pelvis'].includes(k))p[k][0]+=slip*.26;}}
 p.lk[2]+=.12*duck;p.rk[2]+=.12*duck;return p;
}
function punch(p:Pose,side:'l'|'r',amount:number,hook=false){const wrist=side==='l'?'lw':'rw',elbow=side==='l'?'le':'re',sign=side==='l'?-1:1;p[wrist]=mix(p[wrist],[hook?-.12*sign:0,1.69,hook?.95:1.02],amount);p[elbow]=mix(p[elbow],[hook?.5*sign:.15*sign,1.45,.53],amount);p.head[2]+=.07*amount;return p}
function walk(t:number):Pose{const p=standing(),cycle=Math.sin(t*8);p.lf[2]+=.22*cycle;p.rf[2]-=.22*cycle;p.lk[2]+=.12*cycle;p.rk[2]-=.12*cycle;p.lf[1]+=.1*Math.max(0,cycle);p.rf[1]+=.1*Math.max(0,-cycle);p.le=[-.31,1.2,.08+.08*cycle];p.re=[.31,1.2,.08-.08*cycle];p.lw=[-.25,1.43,.18+.1*cycle];p.rw=[.25,1.43,.18-.1*cycle];p.head[1]+=.015*Math.sin(t*16);return p}
function celebrate(t:number):Pose{const p=standing();p.le=[-.48,1.82,0];p.lw=[-.5,2.12,.05];p.re=[.48,1.82,0];p.rw=[.5,2.12,.05];p.head[1]+=.025*Math.sin(t*9);return p}
function limp():Pose{return {head:[.03,.21,-.78],neck:[0,.18,-.57],chest:[0,.2,-.36],pelvis:[0,.21,0],ls:[-.25,.2,-.48],le:[-.48,.15,-.24],lw:[-.6,.1,-.06],rs:[.25,.2,-.48],re:[.46,.15,-.17],rw:[.55,.1,.04],lh:[-.14,.2,.04],lk:[-.2,.16,.44],lf:[-.32,.1,.86],rh:[.14,.2,.04],rk:[.24,.15,.43],rf:[.35,.1,.84]}}
function seated():Pose{const p=standing();for(const k of JOINTS)p[k][1]-=.52;p.lk=[-.3,.24,.45];p.rk=[.3,.24,.45];p.lf=[-.35,.1,.8];p.rf=[.35,.1,.8];p.lw=[-.2,.79,.24];p.rw=[.2,.8,.24];return p}
function choke():Pose{const p=seated();p.rs=[.25,.95,.02];p.re=[.36,1.01,.36];p.rw=[-.19,1.06,.6];p.le=[-.32,1.14,.18];p.lw=[.07,1.23,.58];p.lk=[-.41,.27,.5];p.rk=[.41,.27,.5];p.lf=[-.37,.13,.92];p.rf=[.37,.13,.92];return p}
function referee():Pose{const p=standing();p.le=[-.34,1.12,0];p.lw=[-.3,.88,.05];p.re=[.34,1.12,0];p.rw=[.3,.88,.05];return p}
function refereeStoppage():Pose{const p=standing();p.pelvis=[0,.78,.08];p.chest=[0,1.22,.22];p.neck=[0,1.46,.22];p.head=[0,1.66,.24];p.lh=[-.15,.72,.02];p.lk=[-.23,.36,.3];p.lf=[-.28,.08,.55];p.rh=[.15,.72,.03];p.rk=[.28,.48,-.08];p.rf=[.3,.08,-.18];p.ls=[-.28,1.34,.18];p.le=[-.46,1.18,.46];p.lw=[-.48,1.03,.72];p.rs=[.28,1.34,.18];p.re=[.46,1.18,.46];p.rw=[.48,1.03,.72];return p}
export function choreography(method:FinishMethod,time:number){
 const t=Math.max(0,Math.min(SCENE_LENGTH,time))*5/SCENE_LENGTH;
 const winner:Actor={position:[0,0,-.65],yaw:0,pose:guard(t)};
 const loser:Actor={position:[0,0,.65],yaw:Math.PI,pose:guard(t)};
 const ref:Actor={position:[-1.55,0,.15],yaw:Math.PI/2,pose:referee()};
 let beat='Read the range',impact=0;
 if(method==='decision'){
  winner.position=[-.65,0,0];loser.position=[.65,0,0];ref.position=[0,0,0];winner.yaw=loser.yaw=ref.yaw=0;
  winner.pose=referee();loser.pose=referee();ref.pose=referee();
  const grip=ramp(t,.2,1.2),raise=ramp(t,1.65,3.5);beat=t<1.65?'Referee takes both hands':'Hand raised';
  ref.pose.lw=mix([-.3,.88,.05],[-.35,.88,.05],grip);ref.pose.rw=mix([.3,.88,.05],[.35,.88,.05],grip);
  winner.pose.re=mix([.34,1.12,0],[.48,1.78,0],raise);winner.pose.rw=mix([.3,.88,.05],[.35,2.02,0],raise);
  ref.pose.le=mix([-.34,1.12,0],[-.4,1.68,0],raise);ref.pose.lw=mix(ref.pose.lw,[-.3,2.02,0],raise);
 }else if(method==='ko'){
  winner.pose=guard(t,pulse(t,.22,.7),pulse(t,.6,.95));loser.pose=guard(t,0,-pulse(t,.4,.9));
  punch(loser.pose,'l',pulse(t,.18,.65));punch(winner.pose,'l',pulse(t,.65,.95));
  punch(winner.pose,'r',pulse(t,1.05,1.7),true);winner.position[2]+=.2*ramp(t,1.05,1.4);
  if(t>=1.4){const fall=ramp(t,1.4,2.25);beat='Knockdown';loser.pose=blend(guard(1.4),limp(),fall);loser.position[2]+=.52*fall;impact=pulse(t,1.4,1.6);}
  if(t>=2.25){
   beat='Referee stoppage';loser.pose=limp();ref.position=mix([-1.55,0,.15],[-.72,0,.72],ramp(t,2.25,3.2));ref.pose=blend(referee(),refereeStoppage(),ramp(t,2.45,3.35));
   const approach=ramp(t,2.25,3.05);winner.position=mix([0,0,-.45],[.4,0,-.05],approach);
   const taunt=standing();taunt.head=[0,1.65,.23];taunt.neck=[0,1.5,.12];taunt.le=[-.4,1.12,.25];taunt.re=[.4,1.12,.25];taunt.lw=[-.35,.8,.55];taunt.rw=[.35,.8,.55];
   winner.pose=blend(guard(t),taunt,ramp(t,2.8,3.2));winner.gesture=ramp(t,2.8,3.2)*(1-ramp(t,3.55,3.85));
   const run=ramp(t,3.7,4.72),stride=ramp(t,3.68,3.92)*(1-ramp(t,4.42,4.88));winner.position=mix(winner.position,[1.05,0,-.78],run);winner.yaw=Math.PI*.28*run;const exitBase=blend(winner.pose,standing(),ramp(t,3.72,4.48));winner.pose=blend(exitBase,walk(t),stride);if(t>3.65)beat='Celebration';
  }
 }else{
  const take=ramp(t,.45,1.6);beat=t<1.6?'Back take':'Submission control';winner.position=[.3*Math.sin(take*Math.PI),0,-.65+.28*take];loser.position=[0,0,.65-.35*take];loser.yaw=Math.PI*(1-take);
  winner.pose=blend(winner.pose,seated(),take);loser.pose=blend(loser.pose,seated(),take);
  if(t>=1.6){winner.pose=blend(seated(),choke(),ramp(t,1.6,2.1));loser.pose=seated();}
  if(t>=2.2){beat='Referee stoppage';ref.position=mix([-1.55,0,.15],[-.68,0,-.02],ramp(t,2.2,3));ref.pose=blend(referee(),refereeStoppage(),ramp(t,2.35,3.15));}
  if(t>=2.7){const release=ramp(t,2.7,3.3);winner.position[2]-=.5*release;winner.pose=blend(choke(),seated(),release);loser.pose=blend(seated(),limp(),release);loser.position[2]+=.28*release;
   const stand=ramp(t,3.3,3.9);winner.pose=blend(winner.pose,standing(),stand);
   const silly=standing(),wave=Math.sin(t*20)*.12;silly.head=[.12,1.7,.18];silly.le=[-.5,1.55,0];silly.re=[.5,1.55,0];silly.lw=[-.6,1.95+wave,.1];silly.rw=[.6,1.95-wave,.1];
   winner.pose=blend(winner.pose,silly,ramp(t,3.9,4.1));const run=ramp(t,4.28,4.82),stride=ramp(t,4.22,4.42)*(1-ramp(t,4.58,4.92));winner.position=mix(winner.position,[1.08,0,-.8],run);winner.yaw=Math.PI*.3*run;const exitBase=blend(winner.pose,standing(),ramp(t,4.26,4.72));winner.pose=blend(exitBase,walk(t),stride);if(t>3.9)beat='Goofy celebration';
  }
 }
 return {winner,loser,ref,beat,impact};
}
