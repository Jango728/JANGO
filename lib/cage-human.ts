import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {Actor,Joint} from './fight-choreography';
const cache=new Map<string,Promise<T.Group>>();
const base='models/rocketbox/';
function template(female:boolean){
 const file=female?'Sports_Female_01.fbx':'Sports_Male_01.fbx',prefix=female?'f021':'m021';
 if(!cache.has(file))cache.set(file,(async()=>{
  const manager=new T.LoadingManager();manager.setURLModifier(url=>/\.(tga|jpg|png)$/i.test(url)?base+prefix+(/head/i.test(url)?'_head_color.jpg':'_body_color.jpg'):url);
  manager.addHandler(/\.tga$/i,new T.TextureLoader(manager));
  // FBX ships base64-encoded as .txt so any static host can serve it.
  const b64=await (await fetch(base+file+'.b64.txt')).text();
  const bin=Uint8Array.from(atob(b64.trim()),c=>c.charCodeAt(0));
  const group=new FBXLoader(manager).parse(bin.buffer,base);
  const loader=new T.TextureLoader(),body=await loader.loadAsync(base+prefix+'_body_color.jpg'),head=await loader.loadAsync(base+prefix+'_head_color.jpg');
  body.colorSpace=head.colorSpace=T.SRGBColorSpace;
  group.traverse(o=>{if(o instanceof T.Mesh){const old=Array.isArray(o.material)?o.material:[o.material];o.material=old.map(m=>new T.MeshStandardMaterial({name:m.name,map:/head/i.test(m.name)?head:body,roughness:.72}));o.castShadow=true;o.receiveShadow=true;}});
  return group;
 })());
 return cache.get(file)!;
}
export async function createHuman(scene:T.Scene,color:string,female=false,isRef=false){
 const root=new T.Group(),rig=clone(await template(female)) as T.Group;root.add(rig);root.scale.setScalar(.01);scene.add(root);
 const bones:Record<string,T.Bone>={},rest=new Map<T.Bone,T.Quaternion>();rig.traverse(o=>{if(o instanceof T.Bone){bones[o.name]=o;rest.set(o,o.quaternion.clone())}});
 const bone=(name:string)=>bones['Bip01_'+name];
 // Attached MMA gear follows the rig, rather than floating at procedural points.
 function gear(parent:T.Bone,shape:T.BufferGeometry,position:T.Vector3,tint:string,rotation?:T.Euler){const m=new T.Mesh(shape,new T.MeshStandardMaterial({color:tint,roughness:.78}));m.position.copy(position);if(rotation)m.rotation.copy(rotation);m.castShadow=true;parent.add(m);return m;}
 const attachments:T.Mesh[]=[];
 const gestures:T.Mesh[]=[];
 if(!isRef)for(const side of ['L','R']){const finger=gear(bone(side+'_Hand'),new T.CapsuleGeometry(1.5,10,4,6),new T.Vector3(14,0,0),'#c89776',new T.Euler(0,0,Math.PI/2));finger.visible=false;gestures.push(finger);attachments.push(finger);}
 for(const side of ['L','R']){
  const hand=bone(side+'_Hand');
  const glove=gear(hand,new T.SphereGeometry(1,18,12),new T.Vector3(4,0,0),isRef?'#16191d':'#101216');glove.scale.set(7.8,6.2,8.8);attachments.push(glove);
  const cuff=gear(hand,new T.CylinderGeometry(6.4,6.8,7,16),new T.Vector3(-3,0,0),isRef?'#16191d':color,new T.Euler(0,0,Math.PI/2));attachments.push(cuff);
 }
 // Bone-local X follows the thigh. Sleeves cover the source swimwear with
 // opaque fitted fight shorts; women also receive an opaque sports top.
 for(const side of ['L','R']){const thigh=bone(side+'_Thigh');attachments.push(gear(thigh,new T.CylinderGeometry(12,10,isRef?43:23,16),new T.Vector3(isRef?20:10,0,0),isRef?'#15191f':color,new T.Euler(0,0,Math.PI/2)));if(isRef)attachments.push(gear(bone(side+'_Calf'),new T.CylinderGeometry(9,7,39,14),new T.Vector3(18,0,0),'#15191f',new T.Euler(0,0,Math.PI/2)));}
 const waist=gear(bone('Pelvis'),new T.SphereGeometry(1,24,16),new T.Vector3(0,0,0),isRef?'#15191f':color);waist.scale.set(15,14,22);attachments.push(waist);
 if(female||isRef){const top=gear(bone('Spine2'),new T.SphereGeometry(1,24,16),new T.Vector3(0,0,0),isRef?'#20252c':color);top.scale.set(isRef?23:13,15,23);attachments.push(top);}
 root.updateMatrixWorld(true);
 // RocketBox's L side occupies +X; choreography uses screen-left at -X.
 const links:[string,string,Joint,Joint][]=[['Pelvis','Spine','pelvis','neck'],['Neck','Head','neck','head'],['L_UpperArm','L_Forearm','rs','re'],['L_Forearm','L_Hand','re','rw'],['R_UpperArm','R_Forearm','ls','le'],['R_Forearm','R_Hand','le','lw'],['L_Thigh','L_Calf','rh','rk'],['L_Calf','L_Foot','rk','rf'],['R_Thigh','R_Calf','lh','lk'],['R_Calf','R_Foot','lk','lf']];
 const a=new T.Vector3(),b=new T.Vector3(),target=new T.Vector3(),parentQ=new T.Quaternion(),worldQ=new T.Quaternion(),delta=new T.Quaternion();
 return {root,update(actor:Actor){
  for(const finger of gestures){finger.visible=(actor.gesture??0)>.01;finger.scale.setScalar(actor.gesture??0);}
  root.position.set(...actor.position);root.rotation.set(0,actor.yaw,0);rig.position.set(0,0,0);rest.forEach((q,b)=>b.quaternion.copy(q));root.updateMatrixWorld(true);
  for(const [name,child,j1,j2] of links){const joint=bone(name),end=bone(child);if(!joint||!end)continue;joint.getWorldPosition(a);end.getWorldPosition(b);b.sub(a).normalize();target.set(...actor.pose[j2]).sub(new T.Vector3(...actor.pose[j1])).applyAxisAngle(new T.Vector3(0,1,0),actor.yaw).normalize();if(!target.lengthSq())continue;delta.setFromUnitVectors(b,target);joint.getWorldQuaternion(worldQ);joint.parent!.getWorldQuaternion(parentQ);joint.quaternion.copy(parentQ.invert().multiply(delta).multiply(worldQ));joint.updateWorldMatrix(false,true);}
  // Translate once after solving: fixed limb lengths prevent rubber-like joints.
  bone('Pelvis').getWorldPosition(a);root.worldToLocal(a);target.set(...actor.pose.pelvis).multiplyScalar(100);rig.position.add(target.sub(a));root.updateMatrixWorld(true);
 },dispose(){attachments.forEach(m=>{m.geometry.dispose();(m.material as T.Material).dispose()});scene.remove(root)}};
}
