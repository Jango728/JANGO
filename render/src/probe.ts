import * as T from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
export async function probe() {
  const g = await new FBXLoader().loadAsync("rb/Sports_Male_01.fbx");
  const out: string[] = [];
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if ((o as T.Bone).isBone) {
      const b = o as T.Bone; const p = new T.Vector3(); b.getWorldPosition(p);
      const q = new T.Quaternion(); b.getWorldQuaternion(q);
      const x = new T.Vector3(1, 0, 0).applyQuaternion(q), y = new T.Vector3(0, 1, 0).applyQuaternion(q);
      out.push(`${b.name} parent=${b.parent?.name} pos=${p.toArray().map((v) => v.toFixed(1))} X=${x.toArray().map((v) => v.toFixed(2))} Y=${y.toArray().map((v) => v.toFixed(2))}`);
    }
    if ((o as T.Mesh).isMesh) { const m = o as T.SkinnedMesh; out.push(`MESH ${m.name} verts=${m.geometry.attributes.position.count} mats=${(Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name)}`); }
  });
  out.push("root scale " + g.scale.toArray());
  return out.join("\n");
}
