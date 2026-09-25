import * as T from 'three';
/** Instanced arena seating keeps the environment to a small number of draw calls. */
export function addArena(scene:T.Scene){
 scene.background=new T.Color('#05070b');scene.fog=new T.Fog('#05070b',12,29);
 const add=(g:T.BufferGeometry,m:T.Material)=>{const mesh=new T.Mesh(g,m);scene.add(mesh);return mesh};
 const floor=add(new T.CircleGeometry(24,80),new T.MeshStandardMaterial({color:'#0d1016',roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.62;floor.receiveShadow=true;
 const seats=8*96,chair=new T.InstancedMesh(new T.BoxGeometry(.4,.38,.33),new T.MeshStandardMaterial({color:'#42454a',roughness:.8}),seats),backs=new T.InstancedMesh(new T.BoxGeometry(.4,.4,.1),new T.MeshStandardMaterial({color:'#55575a',roughness:.8}),seats);
 const bodies=new T.InstancedMesh(new T.CapsuleGeometry(.48,.8,3,6),new T.MeshStandardMaterial({color:'#a29a8c',roughness:1}),seats),heads=new T.InstancedMesh(new T.SphereGeometry(.105,10,8),new T.MeshStandardMaterial({color:'#aa9382',roughness:1}),seats);
 const dummy=new T.Object3D();let index=0;
 for(let row=0;row<8;row++){
  const radius=6.6+row*.82,y=-.55+row*.49;
  const tier=add(new T.CylinderGeometry(radius+.53,radius+.53,.25,96,1,true),new T.MeshStandardMaterial({color:'#383a3c',side:T.DoubleSide,roughness:.9}));tier.position.y=y-.15;
  for(let i=0;i<96;i++){
   const angle=i/96*Math.PI*2,aisle=i%24<2,x=Math.sin(angle)*radius,z=Math.cos(angle)*radius;
   dummy.position.set(x,y+.2,z);dummy.rotation.set(0,angle,0);dummy.scale.setScalar(aisle?0:1);dummy.updateMatrix();chair.setMatrixAt(index,dummy.matrix);
   dummy.position.set(x+Math.sin(angle)*.15,y+.49,z+Math.cos(angle)*.15);dummy.updateMatrix();backs.setMatrixAt(index,dummy.matrix);
   dummy.position.set(x,y+.64,z);dummy.scale.setScalar(aisle?0:.28);dummy.updateMatrix();bodies.setMatrixAt(index,dummy.matrix);bodies.setColorAt(index,new T.Color().setHSL((i*.137+row*.09)%1,.28,.15+(i%5)*.055));
   dummy.position.y=y+.96;dummy.scale.setScalar(aisle?0:1);dummy.updateMatrix();heads.setMatrixAt(index,dummy.matrix);index++;
  }
 }
 scene.add(chair,backs,bodies,heads);
 // Visible light banks above the seating bowl, behind the cage at broadcast height.
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6;
  const housing=add(new T.BoxGeometry(1.35,.22,.18),new T.MeshStandardMaterial({color:'#252629',metalness:.5,roughness:.4}));
  housing.position.set(Math.sin(angle)*10.4,3.5,Math.cos(angle)*10.4);housing.lookAt(0,1,0);
  for(let j=0;j<4;j++){const lamp=new T.Mesh(new T.PlaneGeometry(.22,.12),new T.MeshBasicMaterial({color:'#fff4dc'}));lamp.position.set((j-1.5)*.29,0,.095);housing.add(lamp);}
 }
 const trussMaterial=new T.MeshStandardMaterial({color:'#777b7d',metalness:.7,roughness:.4});
 for(const y of [5.8,6.05]){const truss=add(new T.TorusGeometry(4.6,.035,6,8),trussMaterial);truss.rotation.x=Math.PI/2;truss.position.y=y;}
 for(let i=0;i<8;i++){
  const angle=i*Math.PI/4,x=Math.sin(angle)*4.6,z=Math.cos(angle)*4.6;
  const rig=add(new T.BoxGeometry(.72,.17,.4),new T.MeshStandardMaterial({color:'#2c2e32',roughness:.4}));rig.position.set(x,5.85,z);rig.lookAt(0,0,0);
  const light=add(new T.PlaneGeometry(.55,.18),new T.MeshBasicMaterial({color:'#fff0d4',side:T.DoubleSide}));light.position.set(x,5.65,z);light.lookAt(0,0,0);
  if(i%2===0){const spot=new T.SpotLight('#fff1d8',35,20,.58,.85,1.5);spot.position.set(x,5.6,z);spot.target.position.set(0,.5,0);scene.add(spot,spot.target);}
 }
 // Continuous light ribbon around the lower bowl ties the crowd to the mat.
 const ribbon=add(new T.TorusGeometry(6.05,.035,6,96),new T.MeshBasicMaterial({color:'#dfc28a'}));ribbon.rotation.x=Math.PI/2;ribbon.position.y=.15;
 const crowdFill=new T.HemisphereLight('#8893a4','#090a0d',.62);scene.add(crowdFill);
}
