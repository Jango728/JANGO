import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {addArena} from './arena-environment';
import {createHuman} from './cage-human';
import {choreography,type V} from './fight-choreography';
import type {FinishMethod} from './finish';
const vec=(v:V)=>new T.Vector3(...v);
export async function createCage(host:HTMLElement,winnerColor:string,loserColor:string,onChange:()=>void=()=>{},female=false){
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));renderer.setClearColor(0x080b10);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
 host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','Interactive 3D fight cage. Drag to rotate.');renderer.domElement.style.touchAction='pan-y';
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.1,50);camera.position.set(5.2,3.8,7.2);addArena(scene);
 let manualCamera=false,lastTime=-1;const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.6,0);controls.enablePan=false;controls.enableZoom=false;controls.minPolarAngle=.3;controls.maxPolarAngle=1.35;controls.rotateSpeed=.6;controls.update();controls.saveState();controls.addEventListener('change',onChange);controls.addEventListener('start',()=>{manualCamera=true});
 scene.add(new T.HemisphereLight(0xe4e4e2,0x373431,1.5));const key=new T.DirectionalLight(0xfff5e5,2.5);key.position.set(2,6,3);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-4;key.shadow.camera.right=4;key.shadow.camera.top=4;key.shadow.camera.bottom=-4;scene.add(key);const rim=new T.DirectionalLight(0xd3d7df,1.4);rim.position.set(-3,3,-3);scene.add(rim);
 const mat=(color:T.ColorRepresentation,metalness=0)=>new T.MeshStandardMaterial({color,metalness,roughness:.58});
 function mesh(geometry:T.BufferGeometry,material:T.Material,parent:T.Object3D=scene){const m=new T.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
 const platform=mesh(new T.CylinderGeometry(3.5,3.55,.42,8),mat(0x171b22,.25));platform.position.y=-.35;platform.rotation.y=Math.PI/8;
 const floor=mesh(new T.CylinderGeometry(2.9,2.95,.12,8),mat(0xd4d0c5));floor.position.y=-.06;floor.rotation.y=Math.PI/8;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const ctx=canvas.getContext('2d')!;
 ctx.clearRect(0,0,1024,1024);ctx.textAlign='center';ctx.fillStyle='#242424';ctx.font='italic 900 94px Arial';ctx.fillText('JANGO PLAYZ',512,490);ctx.fillStyle='#393c42';ctx.font='600 25px Arial';ctx.fillText('MATCHUP LAB',512,545);ctx.strokeStyle='#6b6d6e';ctx.lineWidth=3;ctx.beginPath();ctx.arc(512,512,305,0,Math.PI*2);ctx.stroke();ctx.font='italic 800 34px Arial';ctx.fillStyle='#b42c2c';ctx.save();ctx.translate(512,150);ctx.fillText('STRIKE LAB',0,0);ctx.restore();ctx.fillStyle='#255d8f';ctx.save();ctx.translate(512,884);ctx.rotate(Math.PI);ctx.fillText('GROUND CO.',0,0);ctx.restore();ctx.fillStyle='#474b51';ctx.font='700 24px Arial';ctx.fillText('APEX FUEL',168,520);ctx.fillText('VELOCITY',856,520);
 const decalTexture=new T.CanvasTexture(canvas);decalTexture.colorSpace=T.SRGBColorSpace;const decal=mesh(new T.PlaneGeometry(4.8,4.8),new T.MeshStandardMaterial({map:decalTexture,transparent:true,depthWrite:false,roughness:1}));decal.rotation.x=-Math.PI/2;decal.position.y=.004;decal.castShadow=false;
 for(let i=0;i<3;i++){const stair=mesh(new T.BoxGeometry(1.05,.16*(i+1),.38),mat(0x30353d,.5));stair.position.set(0,-.56+.08*(i+1),3.65-i*.34);}
 const stage=mesh(new T.CylinderGeometry(4.4,4.4,.025,64),mat(0x0f141c));stage.position.y=-.59;
 const ring=mesh(new T.TorusGeometry(1.2,.016,5,64),mat(0x656b70));ring.rotation.x=-Math.PI/2;ring.position.y=.006;
 const cageMaterial=mat(0x101317,.25),fenceMaterial=new T.LineBasicMaterial({color:0x65768c,transparent:true,opacity:.16});
 const unitCylinder=new T.CylinderGeometry(1,1,1,9),up=new T.Vector3(0,1,0);
 function segment(m:T.Mesh,a:T.Vector3,b:T.Vector3,r:number){m.position.copy(a).add(b).multiplyScalar(.5);const delta=b.clone().sub(a);m.scale.set(r,Math.max(delta.length(),.001),r);m.quaternion.setFromUnitVectors(up,delta.normalize());}
 const corners=Array.from({length:8},(_,i)=>new T.Vector3(Math.sin(i*Math.PI/4+Math.PI/8)*2.78,0,Math.cos(i*Math.PI/4+Math.PI/8)*2.78));
 for(let i=0;i<8;i++){const a=corners[i],b=corners[(i+1)%8];segment(mesh(unitCylinder,cageMaterial),a,b,.035);segment(mesh(unitCylinder,cageMaterial),a.clone().setY(1.7),b.clone().setY(1.7),.075);segment(mesh(unitCylinder,cageMaterial),a,a.clone().setY(1.75),.095);const lines:number[]=[];
  // Thin diagonal mesh fades into the background, keeping the action visible.
  for(let j=-12;j<26;j++)for(const sign of [-1,1]){const start=j*.13,end=start+sign*1.7/2.12;const lo=Math.max(0,Math.min(start,end)),hi=Math.min(1,Math.max(start,end));if(hi<=lo)continue;const y0=(lo-start)/(end-start)*1.7,y1=(hi-start)/(end-start)*1.7;const p=a.clone().lerp(b,lo).setY(y0),q=a.clone().lerp(b,hi).setY(y1);lines.push(...p.toArray(),...q.toArray());}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(lines,3));scene.add(new T.LineSegments(g,fenceMaterial));
 }
 const [winner,loser,ref]=await Promise.all([createHuman(scene,winnerColor,female),createHuman(scene,loserColor,female),createHuman(scene,'#242a32',false,true)]).catch(error=>{controls.dispose();renderer.dispose();renderer.domElement.remove();throw error});
 const burst=mesh(new T.IcosahedronGeometry(.15,0),new T.MeshBasicMaterial({color:0xffce69,transparent:true,opacity:.85}));burst.visible=false;
 function resize(){const width=Math.max(host.clientWidth,1),height=Math.max(host.clientHeight,1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();onChange()}
 const observer=new ResizeObserver(resize);observer.observe(host);resize();
 return {render(method:FinishMethod,t:number){if(t<lastTime)manualCamera=false;lastTime=t;if(!manualCamera){const q=T.MathUtils.smoothstep(t,.7,3.7);camera.position.lerpVectors(new T.Vector3(5.2,3.8,7.2),new T.Vector3(3.7,2.75,5.6),q);controls.target.set(0,method==='ko'||method==='submission'?.68:1,0);}const state=choreography(method,t);winner.update(state.winner);loser.update(state.loser);ref.update(state.ref);burst.visible=false;burst.position.set(0,1.7,.4);burst.scale.setScalar(.5+state.impact);burst.rotation.y=t*10;controls.update();renderer.render(scene,camera);return state.beat},reset(){controls.reset()},orbit(){const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(up,Math.PI/4);camera.position.copy(controls.target).add(offset);controls.update()},dispose(){winner.dispose();loser.dispose();ref.dispose();decalTexture.dispose();observer.disconnect();controls.dispose();scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose())}});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove()}};
}
