# Finish films v2 — what changed and why

Goal: take the projected-finish clips from "cartoon" to fighting-game cutscene realism.
Storyboards, filenames, durations, 1280×720/24 fps and the name-tag track format are unchanged.

## 1. Motion source: CMU mocap (licence-clean)
- v1 used Bandai-Namco "dataset-1/2" BVH (dance-studio punches, CC BY-NC-ND).
- Compared: LAFAN1 `fight1_*` (excellent, but CC BY-NC-ND), Bandai-Namco, CMU. Picked **CMU**
  (free for commercial use): boxing takes 13_17/13_18/14_01/14_02, walk 07_01, run 16_08,
  standing 77_02, get-up 77_18. Clips were found by script (`punches2.py`-style detection of
  hooks/jabs/slips by hand extension, lateral velocity and head drop), then eyeballed on contact sheets.
- KO: W = 13_18 slip (level change) into a looping right; L = 14_01 stepping in with a jab.

## 2. Retargeting: rotation-based (tools/convert_bvh.py + src/retarget.ts)
- v1 aimed bones at source *joint positions* → twist lost, wrists/elbows flipped, limbs "flailed".
- v2: offline, every source bone's world rotation is expressed as a delta from a canonical
  T-pose (`D = Q(t)·Qref⁻¹`, heading-normalised, quats sign-continuous, ≤60 fps). At runtime the
  Rocketbox bind pose is aligned to the same canonical T-pose once and each bone gets
  `D·QtRef` — full 3-DoF incl. forearm roll (half of the hand twist moved into the forearm),
  bone lengths preserved, root scaled by leg-length ratio. CMU T-pose head pitch compensated on
  the boxing subjects.

## 3. IK and contacts (src/motion.ts)
- `FootLock`: contacts detected on the *retargeted* skeleton (ankle low + slow) are pinned with
  two-bone leg IK (foot orientation kept) → no skating from blends/placement edits.
- `punchContact`: knuckle-accurate two-bone arm IK — the hook's glove lands on the jaw at impact.
  The KO placement is *solved*: L is positioned so his jaw sits 11 cm inside W's hook reach, so
  the IK keeps W's elbow bent (a real hook) and the knuckles visibly sink in.
- Grappling (RNC) and cage climb use `poseFromJoints` (joint table → rotations) + arm IK locks
  (forearm across the throat, hand on own biceps, L's hands on the arm, the tap).

## 4. Knockout collapse: Rapier ragdoll (src/ragdoll.ts)
- 11 capsule bodies, spherical joints + soft hinge/cone limits, self-collision groups, CCD.
- Initialised from the animated pose *and its velocity*; hook impulses on head/torso/pelvis;
  "muscle tone" PD (inertia-clamped, stable at 240 Hz) fades: legs go first, then trunk, head
  last. Settling damping + a gentle roll-to-back once he is down (POV finale looks up from the
  canvas). Pre-simulated and baked at setup → deterministic frames. The SUB loser also goes limp
  through the ragdoll on release.

## 5. Characters and gloves (src/body.ts)
- Rocketbox athletes sculpted into MMA builds on the bind mesh (deltoids, traps, lats, pecs,
  arms, quads, calves; waist tightened) with anatomical masks, seam-safe normals, no head seam.
- 4oz MMA gloves are now a skinned shell grown from the hand's own skin (same weights): padded
  knuckle bar and back-of-hand, thin palm, open fingers, trim-coloured cuff bands, white strap,
  stitch line, leather grain. They deform with the fist, bird and open-hand shapes.

## 6. Look (src/film.ts)
- GTAO ambient occlusion, depth of field (depth-aware gather) on the close-ups and POV,
  impact zoom blur + flash + camera shake, dazed double-vision grade in the KO POV, adaptive
  motion-blur subframes on fast action, ACES filmic (AgX available via `?tm=agx`).

## Rendering
- Scratchpad: `v2/batch-v2.sh` (resumable) renders all 12 directly (blue versions are real
  renders, not recolours) into `/home/claude/films-v2`, ~6–10 s/frame on SwiftShader.
- Previews: `preview.html` (clip contact sheets, ragdoll tests), `film.html?...&dbgcam=x,y,z,lx,ly,lz,fov`.
- Legacy v1 scene scripts are kept in `legacy/`.

## Result (Sep 27)
- All 12 rendered (real red and blue renders, no recolouring), staged in `/home/claude/films-v2`
  with comparisons in `films-v2/compare/`, then copied to `jango/public/films` and
  `scripts/merge-film-tracks.py` re-run. v1 films are backed up in `/home/claude/films-v1-backup`.
- Name tags: the loser's tag is hidden during the KO POV finale (his head is the camera).

## Known weaknesses / next steps
- DEC: the cage climb is keyframed (joint tables + IK), not mocap: readable but stiff. CMU 01_06/01_07
  (playground climb, sit, dangle legs) are the best candidate to replace it.
- KO fall is physics-driven but lands as a crumple/sideways drop more often than a clean backward
  timber; tune the impulses per variant if a specific look is wanted.
- The RNC and clown gag are posed from joint tables (no grappling mocap available); the women's
  sports top shows slight clipping under the choking arm.
- Rocketbox faces/skin are still game-asset level (no SSS, no hair cards); the sculpt gives build
  but not fine muscle striation. MetaHuman-class heads are out of reach offline.
- Render cost ~7–10 s/frame on SwiftShader (≈25 min per film).
