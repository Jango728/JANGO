// Node-only asset/rig checks. No browser or live-site interaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {createHuman} from '../lib/cage-human';
import {choreography,SCENE_LENGTH} from '../lib/fight-choreography';
(globalThis as unknown as {window:unknown}).window={URL:{createObjectURL:()=>''}};
T.TextureLoader.prototype.load=function(_url,onLoad){const texture=new T.Texture();queueMicrotask(()=>onLoad?.(texture));return texture;};
FBXLoader.prototype.load=function(url,onLoad){const b=fs.readFileSync('public'+url);const g=this.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');queueMicrotask(()=>onLoad?.(g));};
for(const female of [false,true]){
 const human=await createHuman(new T.Scene(),'#dd4455',female);const bones:Record<string,T.Bone>={};human.root.traverse(o=>{if(o instanceof T.Bone)bones[o.name]=o});
 let length:number|undefined;
 for(const method of ['ko','submission','decision'] as const)for(let time=0;time<=SCENE_LENGTH;time+=.1){
  human.update(choreography(method,time).winner);
  for(const b of Object.values(bones)){const pos=b.getWorldPosition(new T.Vector3());assert(pos.toArray().every(Number.isFinite));assert(pos.length()<6);}
  const elbow=bones.Bip01_L_Forearm.getWorldPosition(new T.Vector3()),hand=bones.Bip01_L_Hand.getWorldPosition(new T.Vector3());const current=elbow.distanceTo(hand);length??=current;assert(Math.abs(current-length)<1e-6,'Forearm length must not stretch');
 }
 human.update(choreography('ko',0).winner);
 assert(bones.Bip01_L_Hand.getWorldPosition(new T.Vector3()).x>0,'Left rig hand must remain on +X in guard');
 human.dispose();
}
console.log('Both licensed human rigs: finite poses, fixed limb lengths and correct guard-side mapping passed.');
