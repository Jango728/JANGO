import * as T from "three";
import { V, at, clip, easeInOut, lerpV, legTo, loop, noise1, place, pose, pingpong, rotatePose, seg, shift, smooth, speed, yawTo, applyShots, clonePose, UPPER, type Shot } from "./director";
import { lerpPose, type Pose } from "./rig";
import { commonClips, refIdle, type Ctx } from "./scene-ko";
import { FENCE_R } from "./arena";

/* ======================================================================
 * DECISION — hand raised, then up on the cage
 * ====================================================================== */
export async function decScript(ctx: Ctx) {
  const { W, L, ref, cam, grade, arena } = ctx;
  const c = await commonClips();
  const raise = await clip("dataset-2_raise-up-both-hands_masculine_001", { trend: false });
  const walkSad = await clip("dataset-1_walk_normal_001");
  const DURATION = 8.9;
  const RAISE = 2.0, BREAK = 3.75, PERCH = 5.35;

  const refPos0 = V(0, 0, 0.3), wPos = V(-0.82, 0, 0.3), lPos = V(0.82, 0, 0.3);
  const fenceSpot = V(0.0, 0, -FENCE_R + 0.08);
  const runFrom = wPos.clone(), runTo = V(-0.1, 0, -FENCE_R + 0.75);
  const runRate = 1.6;
  const runDur = runFrom.distanceTo(runTo) / (speed(c.runRef) * runRate);
  const lWalkTo = V(3.4, 0, 1.6);

  const standing = (s: number, seed: number) => {
    let p = at(c.neutral, 0.05);
    p = shift(p, V(noise1(s * 0.7, seed) * 0.02, 0, 0), UPPER);
    return p;
  };
  const perchPose = (s: number): Pose => {
    const up = pingpong(raise, s, 0.75, 1.55, 0.55);
    const hips = V(0, 1.93, 0.0);
    let p = shift(up, hips.clone().sub(up.hips));
    // legs dangle inside the cage, knees forward
    p.lHip.copy(hips).add(V(0.1, 0, 0));
    p.rHip.copy(hips).add(V(-0.1, 0, 0));
    p = legTo(p, "l", V(0.2, 1.55, 0.38 + 0.04 * Math.sin(s * 3)), V(0.2, 2.1, 1.2), 1, V(0.1, -0.2, 1).normalize());
    p = legTo(p, "r", V(-0.2, 1.52, 0.36 + 0.04 * Math.sin(s * 3 + 1)), V(-0.2, 2.1, 1.2), 1, V(-0.1, -0.2, 1).normalize());
    return p;
  };

  const follow = new T.SpotLight("#fff2de", 0, 14, 0.28, 0.6, 1.2);
  follow.position.set(0.5, 7.5, 1.0);
  follow.target.position.copy(fenceSpot).add(V(0, 2.0, 0));
  ctx.scene.add(follow, follow.target);
  let screenState = "";
  const shots: Shot[] = [
    { start: 0, end: RAISE + 0.55, shake: 0.006, eval: (u) => ({ pos: lerpV(V(0.5, 1.6, 4.3), V(0.2, 1.45, 3.4), easeInOut(u)), look: V(0, 1.3, 0.3), fov: 38 - 6 * u }) },
    { start: RAISE + 0.55, end: BREAK, shake: 0.01, eval: (u) => ({ pos: wPos.clone().add(V(0.6 - 0.2 * u, 1.4, 2.3 - 0.25 * u)), look: wPos.clone().add(V(0.2, 1.62, 0)), fov: 38 }) },
    { start: BREAK, end: PERCH, shake: 0.012, eval: (u) => ({ pos: lerpV(V(-2.4, 1.6, 2.2), V(-2.0, 1.5, -0.4), u), look: W.rig.pos("spine").setY(1.1), fov: 36 }) },
    {
      start: PERCH, end: 99, shake: 0.008,
      eval: (u) => {
        const a = -0.55 + 1.0 * easeInOut(u);
        const base = fenceSpot.clone();
        const r = 3.4 - 1.0 * u;
        return { pos: base.clone().add(V(Math.sin(a) * r, 0.7 + 0.5 * u, Math.cos(a) * r)), look: base.clone().add(V(0, 2.2, 0)), fov: 40 - 4 * u };
      },
    },
  ];

  return {
    duration: DURATION,
    eval(t: number) {
      const s = t;
      const up = easeInOut(seg(s, RAISE, RAISE + 0.55));

      /* ---------------- referee ---------------- */
      const refPos = refPos0.clone().add(V(-0.3 * up, 0, 0)).add(V(1.4 * smooth(seg(s, BREAK - 0.2, BREAK + 1.2)), 0, 0.6 * smooth(seg(s, BREAK - 0.2, BREAK + 1.2))));
      place(ref, refPos, s < BREAK ? 0 : yawTo(refPos, W.root.position) * smooth(seg(s, BREAK, BREAK + 0.6)));
      pose(ref, refIdle(c, s), { ground: 1, hands: ["relaxed", "relaxed"], face: { jaw: 0.05 } });

      /* ---------------- winner ---------------- */
      if (s < BREAK) {
        place(W, wPos, 0.1);
        let p = standing(s, 1);
        p = rotatePose(p, p.neck.clone(), V(1, 0, 0), 0.15 * (1 - up), ["head"]);
        pose(W, p, { ground: 1, hands: ["fist", "fist"], face: { browIn: 0.6 * (1 - up), jaw: 0.1 + 0.55 * up * (0.7 + 0.3 * Math.sin(s * 8)), brow: -0.2 * up } });
        // inner (left) wrist in the ref's hand, raised on the decision
        const low = wPos.clone().add(V(0.3, 0.98, 0.07));
        const high = wPos.clone().add(V(0.3, 1.98, 0.02));
        const wr = low.clone().lerp(high, up);
        wr.y += Math.sin(Math.PI * up) * 0.05;
        W.rig.ik("lArm", wr, W.rig.pos("lUpper").add(V(0.5, -0.3 + 0.3 * up, -0.3)), 1);
        // other arm pumps up too
        const other = wPos.clone().add(V(-0.38, 1.05 + 0.9 * up + 0.05 * Math.sin(s * 9) * up, 0.08));
        W.rig.ik("rArm", other, W.rig.pos("rUpper").add(V(-0.5, -0.2, -0.3)), smooth(seg(s, RAISE + 0.25, RAISE + 0.7)));
        ref.rig.ik("rArm", W.rig.pos("lHand"), ref.rig.pos("rUpper").add(V(-0.4, -0.4, 0.2)), 1);
      } else if (s < PERCH) {
        const u = s - BREAK;
        const dir = runTo.clone().sub(runFrom).normalize();
        const pos = runFrom.clone().addScaledVector(dir, Math.min(runFrom.distanceTo(runTo), Math.max(0, u - 0.15) * speed(c.runRef) * runRate));
        place(W, pos, Math.atan2(dir.x, dir.z) * smooth(seg(u, 0, 0.3)) + 0.1 * (1 - smooth(seg(u, 0, 0.3))));
        const p = loop(c.runRef, u * runRate + 0.3, 0.3, c.runRef.mc.duration - 0.2, 0.25);
        pose(W, lerpPose(standing(s, 1), p, smooth(seg(u, 0, 0.3))), { ground: 1, hands: ["fist", "fist"], face: { jaw: 0.6, brow: 0.3 } });
      } else {
        const u = s - PERCH;
        place(W, fenceSpot, 0);
        pose(W, perchPose(u), { hands: ["fist", "fist"], face: { jaw: 0.55 + 0.25 * Math.abs(Math.sin(u * 4)), browIn: 0.8, eyes: 0.3 }, head: [Math.sin(u * 1.3) * 0.35, -0.2, 0] });
      }

      /* ---------------- loser ---------------- */
      if (s < BREAK - 0.3) {
        place(L, lPos, -0.1);
        let p = standing(s, 2);
        const drop = smooth(seg(s, RAISE + 0.2, RAISE + 0.8));
        p = rotatePose(p, p.neck.clone(), V(1, 0, 0), 0.15 + 0.35 * drop, ["head"]);
        p = rotatePose(p, p.hips.clone(), V(1, 0, 0), 0.08 * drop, UPPER);
        pose(L, p, { ground: 1, hands: ["relaxed", "relaxed"], face: { browIn: 0.7, eyes: -0.3 * drop, smile: -0.5 * drop } });
        // inner (right) wrist held by the ref until the decision, then hands to the hips
        const held = lPos.clone().add(V(-0.3, 0.98, 0.07));
        if (drop < 1) L.rig.ik("rArm", held, L.rig.pos("rUpper").add(V(-0.4, -0.3, -0.3)), 1 - drop);
        if (drop > 0) {
          L.rig.ik("lArm", L.rig.pos("pelvis").add(V(0.2, 0.05, 0.02)), L.rig.pos("lUpper").add(V(0.5, -0.2, -0.3)), drop);
          L.rig.ik("rArm", L.rig.pos("pelvis").add(V(-0.2, 0.05, 0.02)), L.rig.pos("rUpper").add(V(-0.5, -0.2, -0.3)), drop);
        }
        if (s < RAISE + 0.3) ref.rig.ik("lArm", L.rig.pos("rHand"), ref.rig.pos("lUpper").add(V(0.4, -0.4, 0.2)), 1 - smooth(seg(s, RAISE, RAISE + 0.3)));
      } else {
        // walks off to his corner, head down
        const u = s - (BREAK - 0.3);
        const dir = lWalkTo.clone().sub(lPos).normalize();
        const pos = lPos.clone().addScaledVector(dir, Math.min(lPos.distanceTo(lWalkTo), u * speed(walkSad) * 0.8));
        const yaw = -0.1 + (Math.atan2(dir.x, dir.z) + 0.1) * smooth(seg(u, 0, 0.5));
        place(L, pos, yaw);
        let p = loop(walkSad, u * 0.8 + 1.0, 0.8, walkSad.mc.duration - 0.8, 0.3);
        p = rotatePose(p, p.neck.clone(), V(1, 0, 0), 0.45, ["head"]);
        p = lerpPose(standing(s, 2), p, smooth(seg(u, 0, 0.4)));
        pose(L, p, { ground: 1, hands: ["relaxed", "relaxed"], face: { browIn: 0.7, eyes: -0.4, smile: -0.5 } });
      }

      /* ---------------- camera, grade ---------------- */
      applyShots(cam, shots, s);
      grade.uniforms.uFlash.value = 0;
      follow.intensity = s > PERCH ? 160 : 0;
      grade.uniforms.uFade.value = 1 - smooth(seg(t, 0, 0.35));
      const label = s < RAISE ? "DECISION" : "WINNER";
      if (label !== screenState) {
        arena.setScreen([label], "#b3121c");
        screenState = label;
      }
      (arena.camFlashes.material as T.ShaderMaterial).uniforms.uTime.value = s * (s > RAISE ? 2.4 : 1.2);
      void clonePose;
      return s;
    },
  };
}
