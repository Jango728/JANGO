"use client";
import {useEffect,useRef,useState} from 'react';
import {Play,RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {SCENE_LENGTH} from '@/lib/fight-choreography';
import type {FinishMethod} from '@/lib/finish';
import type {createCage} from '@/lib/cage-engine';
type Engine=Awaited<ReturnType<typeof createCage>>;
export function CagePlayer({method,winner,opponent,winnerColor,loserColor,isPreview,female=false}:{method:FinishMethod;winner:string;opponent:string;winnerColor:string;loserColor:string;isPreview:boolean;female?:boolean}){
 const host=useRef<HTMLDivElement>(null),engine=useRef<Engine|null>(null),clock=useRef(0),running=useRef(false),visible=useRef(false),dirty=useRef(true);
 const [entered,setEntered]=useState(false),[ready,setReady]=useState(false),[failed,setFailed]=useState(false),[playing,setPlaying]=useState(false),[finished,setFinished]=useState(false),[reduced,setReduced]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting;dirty.current=true;if(entry.isIntersecting)setEntered(true)},{threshold:.2});if(host.current)observer.observe(host.current);return()=>observer.disconnect()},[]);
 useEffect(()=>{
  if(!entered||!host.current)return;let disposed=false,raf=0,last=0;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');const motion=()=>{setReduced(media.matches);if(media.matches){running.current=false;setPlaying(false)}};motion();media.addEventListener('change',motion);
  const lost=(e:Event)=>{e.preventDefault();running.current=false;setFailed(true);setReady(false)};
  const wake=()=>{last=0;dirty.current=true};document.addEventListener('visibilitychange',wake);
  import('@/lib/cage-engine').then(async({createCage})=>{
   if(disposed||!host.current)return;const created=await createCage(host.current,winnerColor,loserColor,()=>{dirty.current=true},female);if(disposed){created.dispose();return;}engine.current=created;
   host.current.querySelector('canvas')?.addEventListener('webglcontextlost',lost);setReady(true);running.current=!media.matches;setPlaying(running.current);
   const tick=(now:number)=>{if(disposed)return;const dt=last?(now-last)/1000:0;last=now;if(visible.current&&!document.hidden){if(running.current){clock.current=Math.min(SCENE_LENGTH,clock.current+dt);dirty.current=true;if(clock.current>=SCENE_LENGTH){running.current=false;setPlaying(false);setFinished(true)}}if(dirty.current){created.render(method,clock.current);dirty.current=false}}raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);
  }).catch(()=>{if(!disposed){setFailed(true);setReady(false);running.current=false;setPlaying(false)}});
  return()=>{disposed=true;cancelAnimationFrame(raf);media.removeEventListener('change',motion);document.removeEventListener('visibilitychange',wake);host.current?.querySelector('canvas')?.removeEventListener('webglcontextlost',lost);engine.current?.dispose();engine.current=null};
 },[entered,method,winnerColor,loserColor,female]);
 function replay(){clock.current=0;setFinished(false);running.current=true;setPlaying(true);dirty.current=true}
 return <div className="finish-player cage-player"><div className="cage-stage"><div className="cage-render" ref={host}/>{!ready&&<div className="finish-loading">{failed?'3D playback is unavailable in this browser.':'Preparing the arena…'}</div>}{finished&&<div className="scene-result"><strong>{winner}</strong><span>{isPreview?'Scenario winner':'Predicted winner'}</span></div>}{ready&&!playing&&<Button className="scene-replay" variant="secondary" size="sm" onClick={replay} disabled={!ready||playing} aria-label={reduced&&!finished?'Play ten-second animation':'Replay ten-second animation'}>{reduced&&!finished?<Play size={14}/>:<RotateCcw size={14}/>} {playing?'Playing':reduced&&!finished?'Play':'Replay'}</Button>}</div><div className="cage-corners"><span><i style={{background:winnerColor}}/>{winner}</span><span><i style={{background:loserColor}}/>{opponent}</span></div></div>;
}
