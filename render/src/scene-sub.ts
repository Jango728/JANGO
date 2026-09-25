import * as T from "three";
import {
  V, at, clamp, clip, easeInOut, easeOut, lerpV, legTo, armTo, loop, noise1, place, pose, rotatePose, seg, shift, smooth, toWorld, yawTo, applyShots, clonePose,
  UPPER, HEADSET, type Shot,
} from "./director";
import { lerpPose, type Pose, type J } from "./rig";
import { commonClips, stancePose, refIdle, circleRun, type Ctx } from "./scene-ko";

/** Build a pose from a joint table (metres, actor space) */
function P(t: Partial<Record<J, [number, number, number]>>, base?: Pose): Pose {
  const o = base ? clonePose(base) : ({} as Pose);
  for (const [k, v] of Object.entries(t)) o[k as J] = V(...(v as [number, number, number]));
  return o;
}

/* ======================================================================
 * SUBMISSION — rear-naked choke
 * ====================================================================== */
export async function subScript(ctx: Ctx) {
  const { W, L, ref, cam, grade, arena } = ctx;
  const c = await commonClips();
  const goofy = await clip("dataset-1_run_childish_001");
  const DURATION = 7.63; // ends on the clown face
  const CUT = 2.35; // cut to the ground
  const TAP = 4.35, RELEASE = 5.15, STAND = 6.0, RUN = 7.6;

  // standing exchange layout
  const C = V(0.0, 0, 0.3);
  const lineAt = (s: number) => {
    const phi = -0.7 + 0.7 * smooth(seg(s, 0, 2.0));
    const d = 2.3 - 1.2 * smooth(seg(s, 0.2, 2.0));
    return { dir: V(Math.cos(phi), 0, Math.sin(phi)), d };
  };

  // ground position: both face +Z (toward the main camera side); L sits in front
  const G = V(0.2, 0, 0.1);
  const gYaw = 0.25;
  const lSit: Pose = P({
    hips: [0, 0.14, 0], spine: [0, 0.26, -0.04], chest: [0, 0.52, -0.13], neck: [0, 0.74, -0.2], head: [0, 0.83, -0.14],
    lClav: [0.03, 0.71, -0.19], lSh: [0.18, 0.69, -0.17], rClav: [-0.03, 0.71, -0.19], rSh: [-0.18, 0.69, -0.17],
    lEl: [0.28, 0.55, -0.04], lWr: [0.08, 0.72, -0.03], rEl: [-0.26, 0.55, -0.02], rWr: [-0.05, 0.72, -0.05],
    lHip: [0.09, 0.14, 0], lKn: [0.22, 0.42, 0.32], lAn: [0.27, 0.1, 0.62], lToe: [0.3, 0.02, 0.75],
    rHip: [-0.09, 0.14, 0], rKn: [-0.2, 0.38, 0.33], rAn: [-0.31, 0.1, 0.63], rToe: [-0.34, 0.02, 0.76],
  });
  // W behind him; coordinates here are in L's frame, converted to W's frame by +0.3 z
  const wBehind: Pose = P({
    hips: [0, 0.15, -0.34], spine: [0, 0.27, -0.37], chest: [0, 0.56, -0.4], neck: [0.02, 0.8, -0.38], head: [0.11, 0.89, -0.3],
    lClav: [0.03, 0.77, -0.39], lSh: [0.17, 0.77, -0.37], rClav: [-0.03, 0.77, -0.39], rSh: [-0.13, 0.78, -0.34],
    rEl: [0.0, 0.72, -0.07], rWr: [0.19, 0.8, -0.26], lEl: [0.22, 1.0, -0.26], lWr: [0.03, 0.96, -0.33],
    lHip: [0.09, 0.15, -0.34], lKn: [0.35, 0.33, -0.08], lAn: [0.2, 0.17, 0.2], lToe: [0.12, 0.12, 0.3],
    rHip: [-0.09, 0.15, -0.34], rKn: [-0.35, 0.33, -0.08], rAn: [-0.2, 0.17, 0.2], rToe: [-0.12, 0.12, 0.3],
  });
  const wOff = V(0, 0, 0.0);
  const toW = (p: Pose) => shift(p, V(0, 0, 0)); // same frame (both share root G)

  // after the release: L slumped on his right side, W stands at his feet
  const refStart = V(-2.2, 0, -1.6);
  const refSpot = toWorld(G, gYaw, V(-0.75, 0, 0.35));
  const wStand = toWorld(G, gYaw, V(0.45, 0, 1.35));
  const lMid = toWorld(G, gYaw, V(-0.25, 0, -0.1));

  let screenState = "";
  const shots: Shot[] = [
    { start: 0, end: 1.9, shake: 0.006, eval: (u) => ({ pos: lerpV(V(-6.8, 5.0, 7.2), V(-3.6, 2.2, 5.0), easeInOut(u)), look: lerpV(V(0, 0.9, 0.3), V(0.1, 1.15, 0.3), u), fov: 33 - 4 * u }) },
    { start: 1.9, end: CUT, shake: 0.012, eval: (u) => ({ pos: V(0.4 - 0.3 * u, 1.4, 3.4), look: V(0.0, 1.2, 0.3), fov: 30 }) },
    { start: CUT, end: 3.55, shake: 0.008, eval: (u) => ({ pos: toWorld(G, gYaw, V(0.9 - 0.5 * u, 0.62, 2.3 - 0.4 * u)), look: toWorld(G, gYaw, V(0, 0.6, -0.15)), fov: 30 }) },
    { start: 3.55, end: 4.75, shake: 0.006, eval: (u) => ({ pos: toWorld(G, gYaw, V(-0.45 + 0.1 * u, 0.95, 1.45 - 0.15 * u)), look: toWorld(G, gYaw, V(0.05, 0.82, -0.22)), fov: 28 }) },
    { start: 4.75, end: STAND, shake: 0.01, eval: (u) => ({ pos: toWorld(G, gYaw, V(2.2 - 0.3 * u, 1.05, 1.6)), look: toWorld(G, gYaw, V(-0.3, 0.55, -0.1)), fov: 32 }) },
    {
      start: STAND, end: RUN, shake: 0.009,
      eval: (u) => {
        const toL = lMid.clone().sub(wStand).setY(0).normalize();
        let side = V(-toL.z, 0, toL.x);
        // swing wide on the side away from the referee
        if (wStand.clone().addScaledVector(side, 1).distanceTo(refSpot) < wStand.clone().addScaledVector(side, -1).distanceTo(refSpot)) side.negate();
        return { pos: wStand.clone().addScaledVector(toL, 1.9 - 0.35 * u).addScaledVector(side, 1.05).add(V(0, 1.45, 0)), look: wStand.clone().add(V(0, 1.42, 0)), fov: 31 - 5 * u };
      },
    },
    {
      start: RUN, end: 99, shake: 0.008,
      eval: (u, s) => {
        const a = 0.9 + (s - RUN) * 0.3;
        return { pos: lMid.clone().add(V(Math.sin(a) * 4.3, 2.4, Math.cos(a) * 4.3)), look: W.rig.pos("spine").lerp(lMid, 0.5).setY(0.7), fov: 33 };
      },
    },
  ];

  return {
    duration: DURATION,
    eval(t: number) {
      const s = t;
      let lookAtW = false;

      /* ---------------- standing exchange ---------------- */
      if (s < CUT) {
        const { dir, d } = lineAt(s);
        const wp = C.clone().addScaledVector(dir, -d / 2), lp = C.clone().addScaledVector(dir, d / 2);
        place(W, wp, yawTo(wp, lp));
        let wpz = stancePose(c, s, 0);
        const pw = smooth(seg(s, 1.55, 1.75)) * (1 - smooth(seg(s, 2.1, 2.35)));
        if (pw > 0) wpz = lerpPose(wpz, at(c.punch, clamp(1.45 + (s - 1.75), 1.45, 2.2)), pw);
        pose(W, wpz, { ground: 1, face: { browIn: 0.7 } });
        place(L, lp, yawTo(lp, wp));
        let lpz = stancePose(c, s, 0.9);
        // L covers up and ducks under
        const duck = smooth(seg(s, 1.7, 2.0));
        if (duck > 0) {
          lpz = shift(lpz, V(0, -0.2, 0.08), UPPER, duck);
          lpz = shift(lpz, V(0, -0.14, 0), ["hips", "lHip", "rHip"], duck);
          lpz = legTo(lpz, "l", lpz.lAn.clone(), lpz.lKn.clone().add(V(0, 0, 0.5)));
          lpz = legTo(lpz, "r", lpz.rAn.clone(), lpz.rKn.clone().add(V(0, 0, 0.5)));
        }
        pose(L, lpz, { ground: 1, face: { browIn: 0.5 } });
      } else if (s < RELEASE) {
        /* ---------------- the choke ---------------- */
        const u = s - CUT;
        const squeeze = smooth(seg(u, 0, 1.6));
        // L: fights the hands, kicks, then taps
        let lp = clonePose(lSit);
        lp = rotatePose(lp, lp.hips.clone(), V(1, 0, 0), -0.12 * squeeze, UPPER);
        lp.lAn.add(V(0, 0.05 * Math.max(0, Math.sin(u * 7)), 0.1 * Math.sin(u * 3.5)));
        lp.rAn.add(V(0, 0.04 * Math.max(0, Math.sin(u * 6 + 1)), 0.12 * Math.sin(u * 3 + 2)));
        lp = legTo(lp, "l", lp.lAn.clone(), lp.lKn.clone().add(V(0.1, 0.4, 0)));
        lp = legTo(lp, "r", lp.rAn.clone(), lp.rKn.clone().add(V(-0.1, 0.4, 0)));
        // pulling at the arm (small tugs)
        const tug = Math.sin(u * 9) * 0.015;
        lp.lWr.add(V(0, tug, 0));
        lp.rWr.add(V(0, -tug, 0));
        const tapU = seg(s, TAP, TAP + 0.8);
        if (tapU > 0 && tapU < 1) {
          // left hand leaves the arm and taps W's forearm three times
          const pat = Math.abs(Math.sin(tapU * Math.PI * 3));
          const hand = V(0.2, 0.84, -0.2).add(V(0.06 * pat, 0.08 * pat, 0));
          lp = armTo(lp, "l", hand, V(0.5, 0.6, 0.1));
        }
        place(L, G, gYaw);
        pose(L, lp, { hands: [tapU > 0 && tapU < 1 ? "open" : "fist", "fist"], face: { browIn: 1, eyes: -0.35 - 0.3 * squeeze, jaw: 0.25 + 0.15 * Math.sin(u * 5), smile: -0.6 } });
        // W: arch back and squeeze
        let wp = clonePose(wBehind);
        wp = rotatePose(wp, wp.hips.clone(), V(1, 0, 0), -0.1 * squeeze, UPPER);
        place(W, G, gYaw);
        pose(W, toW(wp), { hands: ["open", "fist"], face: { browIn: 1, jaw: 0.1, smile: -0.4, eyes: -0.3 } });
        // lock the grip exactly: right forearm across the throat, left hand on the back of his head
        const throat = L.rig.pos("neck").add(toWorld(V(), gYaw, V(0, 0.02, 0.07)));
        W.rig.ik("rArm", L.rig.pos("lUpper").add(toWorld(V(), gYaw, V(0.02, 0.1, -0.05))), throat.clone().add(toWorld(V(), gYaw, V(0, -0.05, 0.1))), 1);
        W.rig.ik("lArm", L.rig.pos("head").add(toWorld(V(), gYaw, V(0.02, 0.1, -0.12))), W.rig.pos("lUpper").add(toWorld(V(), gYaw, V(0.4, 0.3, 0.1))), 0.9);
        void wOff;
      } else if (s < STAND) {
        /* ---------------- release: ref pulls W off, L slumps ---------------- */
        const u = s - RELEASE;
        const slump = easeOut(seg(u, 0.05, 0.7));
        let lp = clonePose(lSit);
        lp = shift(lp, V(0, 0, 0.02));
        // arms drop to the mat
        lp = armTo(lp, "l", V(0.34, 0.12, 0.05), V(0.5, 0.4, -0.1), smooth(seg(u, 0, 0.3)));
        lp = armTo(lp, "r", V(-0.32, 0.12, 0.1), V(-0.5, 0.4, -0.1), smooth(seg(u, 0, 0.3)));
        // topples onto his right side
        lp = rotatePose(lp, lp.hips.clone(), V(0, 0, 1), 1.25 * slump, UPPER);
        lp = rotatePose(lp, lp.hips.clone(), V(1, 0, 0), -0.35 * slump, UPPER);
        const minY = Math.min(lp.chest.y, lp.neck.y, lp.head.y);
        if (minY < 0.12) lp = shift(lp, V(0, 0.12 - minY, 0), UPPER);
        lp = legTo(lp, "l", lp.lAn.clone().add(V(-0.1 * slump, 0, 0)), lp.lKn.clone().add(V(-0.2, 0.2, 0)));
        place(L, G, gYaw);
        pose(L, lp, { hands: ["relaxed", "relaxed"], face: { eyes: -1, jaw: 0.45 } });
        // W unwraps and leans back
        let wp = lerpPose(wBehind, P({ lWr: [0.3, 0.55, -0.2], rWr: [-0.3, 0.55, -0.2], lEl: [0.3, 0.7, -0.35], rEl: [-0.3, 0.7, -0.35], lAn: [0.35, 0.1, 0.25], rAn: [-0.35, 0.1, 0.25], lToe: [0.36, 0.02, 0.37], rToe: [-0.36, 0.02, 0.37] }, wBehind), smooth(seg(u, 0.1, 0.45)));
        wp = rotatePose(wp, wp.hips.clone(), V(1, 0, 0), -0.3 * smooth(seg(u, 0.1, 0.6)), UPPER);
        wp = legTo(wp, "l", wp.lAn.clone(), wp.lKn.clone().add(V(0.2, 0.3, 0)));
        wp = legTo(wp, "r", wp.rAn.clone(), wp.rKn.clone().add(V(-0.2, 0.3, 0)));
        place(W, G, gYaw);
        pose(W, wp, { hands: ["open", "open"], face: { brow: 0.5, jaw: 0.35 } });
      } else {
        /* ---------------- clown taunt, then goofy lap ---------------- */
        const u = s - STAND;
        // L stays slumped
        let lp = clonePose(lSit);
        lp = armTo(lp, "l", V(0.34, 0.12, 0.05), V(0.5, 0.4, -0.1));
        lp = armTo(lp, "r", V(-0.32, 0.12, 0.1), V(-0.5, 0.4, -0.1));
        lp = rotatePose(lp, lp.hips.clone(), V(0, 0, 1), 1.25, UPPER);
        lp = rotatePose(lp, lp.hips.clone(), V(1, 0, 0), -0.35, UPPER);
        const minY = Math.min(lp.chest.y, lp.neck.y, lp.head.y);
        if (minY < 0.12) lp = shift(lp, V(0, 0.12 - minY, 0), UPPER);
        lp = legTo(lp, "l", lp.lAn.clone().add(V(-0.1, 0, 0)), lp.lKn.clone().add(V(-0.2, 0.2, 0)));
        place(L, G, gYaw);
        pose(L, lp, { hands: ["relaxed", "relaxed"], face: { eyes: -1, jaw: 0.45 } });

        if (s < RUN + 0.3) {
          const yaw = yawTo(wStand, lMid);
          place(W, wStand, yaw);
          let p = at(c.neutral, 0.05);
          // goofy bounce and side-to-side sway, thumbs at the temples, fingers waving
          const bounce = Math.abs(Math.sin(u * 7)) * 0.05;
          p = shift(p, V(0, -bounce, 0), ["hips", "spine", "chest", "neck", "head", "lClav", "rClav", "lSh", "rSh", "lEl", "rEl", "lWr", "rWr", "lHip", "rHip"]);
          p = legTo(p, "l", p.lAn.clone().add(V(0.08, 0, 0)), p.lKn.clone().add(V(0.4, 0, 0.5)));
          p = legTo(p, "r", p.rAn.clone().add(V(-0.08, 0, 0)), p.rKn.clone().add(V(-0.4, 0, 0.5)));
          p = rotatePose(p, p.hips.clone(), V(0, 0, 1), Math.sin(u * 5) * 0.12, UPPER);
          p = rotatePose(p, p.hips.clone(), V(1, 0, 0), 0.12, UPPER);
          const hy = p.head.y + 0.06;
          p = armTo(p, "l", V(0.13, hy, p.head.z + 0.02), V(0.6, hy - 0.1, -0.1));
          p = armTo(p, "r", V(-0.13, hy, p.head.z + 0.02), V(-0.6, hy - 0.1, -0.1));
          p = lerpPose(at(c.neutral, 0.05), p, smooth(seg(u, 0, 0.3)));
          pose(W, p, { ground: 1, hands: ["spread", "spread"], face: { tongue: smooth(seg(u, 0.1, 0.3)), jaw: 0.85, brow: 1.4, eyes: 1.2, smile: 0.7 }, head: [Math.sin(u * 5) * 0.2, 0.25, Math.sin(u * 5 + 1) * 0.15] });
          // wave the hands (whole hand flaps around the thumb)
          for (const side of ["l", "r"] as const) {
            const hb = W.rig.b(`${side}Hand`);
            hb.quaternion.multiply(new T.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.sin(u * 16 + (side === "l" ? 0 : 1.5)) * 0.5));
            hb.updateMatrixWorld(true);
          }
          lookAtW = true;
          if (s > RUN) {
            const r = circleRun(goofy, s - RUN, lMid, 1.5, Math.atan2(wStand.z - lMid.z, wStand.x - lMid.x), 1, 1.5);
            const w = smooth(seg(s, RUN, RUN + 0.3));
            place(W, lerpV(wStand, r.pos, w), yaw + (r.yaw - yaw) * w);
            pose(W, lerpPose(p, r.pose, w), { ground: 1, hands: ["spread", "spread"], face: { tongue: 1, jaw: 0.6, brow: 1, eyes: 1, smile: 0.5 } });
          }
        } else {
          const r = circleRun(goofy, s - RUN, lMid, 1.5, Math.atan2(wStand.z - lMid.z, wStand.x - lMid.x), 1, 1.5);
          place(W, r.pos, r.yaw);
          pose(W, r.pose, { ground: 1, hands: ["spread", "spread"], face: { tongue: 1, jaw: 0.6, brow: 1, eyes: 1, smile: 0.5 } });
        }
      }
      void lookAtW;

      /* ---------------- referee ---------------- */
      if (s < TAP + 0.3) {
        place(ref, V(-0.2, 0, -2.4), yawTo(V(-0.2, 0, -2.4), s < CUT ? C : G));
        pose(ref, refIdle(c, s), { ground: 1, hands: ["relaxed", "relaxed"] });
      } else if (s < RELEASE) {
        const u = seg(s, TAP + 0.3, RELEASE);
        const from = V(-0.2, 0, -2.4);
        const pos = lerpV(from, refSpot, easeInOut(u));
        place(ref, pos, yawTo(pos, G));
        const p = loop(c.runRef, (s - TAP) * 1.4, 0.3, c.runRef.mc.duration - 0.2, 0.25);
        pose(ref, lerpPose(refIdle(c, s), p, smooth(seg(s, TAP + 0.3, TAP + 0.5)) * (1 - smooth(seg(u, 0.85, 1)))), { ground: 1, hands: ["open", "open"], face: { jaw: 0.3 } });
      } else {
        const u = s - RELEASE;
        place(ref, refSpot, yawTo(refSpot, G));
        // leaning in with both hands on W's shoulders, pulling back, then crouching by L
        let p = at(c.neutral, 0.05);
        p = rotatePose(p, p.hips.clone(), V(1, 0, 0), 0.55, UPPER);
        p = shift(p, V(0, -0.18, 0), ["hips", "spine", "chest", "neck", "head", "lClav", "rClav", "lSh", "rSh", "lEl", "rEl", "lWr", "rWr", "lHip", "rHip"]);
        p = legTo(p, "l", p.lAn.clone().add(V(0.05, 0, 0.1)), p.lKn.clone().add(V(0, 0, 0.6)));
        p = legTo(p, "r", p.rAn.clone().add(V(-0.05, 0, -0.15)), p.rKn.clone().add(V(0, 0, 0.6)));
        pose(ref, p, { ground: 1, hands: ["open", "open"], face: { jaw: 0.3, brow: 0.5 } });
        if (s < STAND) {
          const pull = 1 - smooth(seg(u, 0.5, 0.85));
          ref.rig.ik("rArm", W.rig.pos("lUpper"), ref.rig.pos("rUpper").add(V(0, -0.4, 0)), pull);
          ref.rig.ik("lArm", L.rig.pos("rUpper").add(V(0, 0.05, 0)), ref.rig.pos("lUpper").add(V(0, -0.4, 0)), 0.8);
        } else {
          ref.rig.ik("lArm", L.rig.pos("spine2").add(V(0, 0.12, 0)), ref.rig.pos("lUpper").add(V(0, -0.4, 0)), 1);
        }
      }

      /* ---------------- camera, grade ---------------- */
      applyShots(cam, shots, s);
      grade.uniforms.uFlash.value = s > CUT ? 0.2 * Math.exp(-(s - CUT) / 0.05) : 0;
      grade.uniforms.uFade.value = 1 - smooth(seg(t, 0, 0.35));
      const label = s < TAP + 0.5 ? "FIGHT NIGHT" : "SUBMISSION";
      if (label !== screenState) {
        arena.setScreen([label], "#b3121c");
        screenState = label;
      }
      (arena.camFlashes.material as T.ShaderMaterial).uniforms.uTime.value = s * (s > TAP ? 2.2 : 1);
      void noise1; void HEADSET; void easeOut;
      return s;
    },
  };
}
