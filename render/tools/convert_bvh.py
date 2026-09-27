#!/usr/bin/env python3
"""
Offline BVH -> rotation-retarget-ready motion (.json header + .bin float32 frames).

For every mapped joint we store the world-space *delta* rotation
    D(t) = Qsrc(t) * inv(QsrcRef)
where QsrcRef is the source bone's orientation in a reference T-pose that has
been swing-corrected so the bone points along a canonical direction.  The
runtime (src/retarget.ts) aligns the target skeleton's bind pose to the same
canonical directions (QtgtRef) and poses it with  Qtgt(t) = D(t) * QtgtRef.
This carries full 3-DoF rotation incl. twist (forearm roll, head, feet), so
limbs keep their own lengths and never stretch.

World is normalised so the reference frame faces +Z with the actor's left on +X,
Y up, metres.  Per frame we store: hips position (3), then per joint quat (4),
then ankle + toe world positions (12) for contact detection/foot locking.

usage: convert_bvh.py in.bvh out_name [--ref rest|frame0] [--from s] [--to s] [--fps 30]
"""
import sys, json, argparse, numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bvhlib import load, fk
from scipy.spatial.transform import Rotation as R

KEYS = ["hips", "spine", "spine1", "spine2", "neck", "head",
        "lClav", "lUpper", "lFore", "lHand", "rClav", "rUpper", "rFore", "rHand",
        "lThigh", "lCalf", "lFoot", "lToe", "rThigh", "rCalf", "rFoot", "rToe"]
# candidate source names per key (LAFAN1 / CMU (cgspeed) / Bandai-Namco)
NAMES = {
    "hips": ["Hips"], "spine": ["Spine", "LowerBack"], "spine1": ["Spine1", "Spine", "Chest"], "spine2": ["Spine2", "Spine1", "Chest"],
    "neck": ["Neck", "Neck1"], "head": ["Head"],
    "lClav": ["LeftShoulder", "Shoulder_L"], "lUpper": ["LeftArm", "UpperArm_L"], "lFore": ["LeftForeArm", "LowerArm_L"], "lHand": ["LeftHand", "Hand_L"],
    "rClav": ["RightShoulder", "Shoulder_R"], "rUpper": ["RightArm", "UpperArm_R"], "rFore": ["RightForeArm", "LowerArm_R"], "rHand": ["RightHand", "Hand_R"],
    "lThigh": ["LeftUpLeg", "UpperLeg_L"], "lCalf": ["LeftLeg", "LowerLeg_L"], "lFoot": ["LeftFoot", "Foot_L"], "lToe": ["LeftToe", "LeftToeBase", "Toes_L"],
    "rThigh": ["RightUpLeg", "UpperLeg_R"], "rCalf": ["RightLeg", "LowerLeg_R"], "rFoot": ["RightFoot", "Foot_R"], "rToe": ["RightToe", "RightToeBase", "Toes_R"],
}
CHILD = {"hips": "spine", "spine": "spine1", "spine1": "spine2", "spine2": "neck", "neck": "head", "head": None,
         "lClav": "lUpper", "lUpper": "lFore", "lFore": "lHand", "lHand": None,
         "rClav": "rUpper", "rUpper": "rFore", "rFore": "rHand", "rHand": None,
         "lThigh": "lCalf", "lCalf": "lFoot", "lFoot": "lToe", "lToe": None,
         "rThigh": "rCalf", "rCalf": "rFoot", "rFoot": "rToe", "rToe": None}
# canonical T-pose directions (character space: +X left, +Y up, +Z forward); None = use source ref direction
IDEAL = {"lUpper": (1, 0, 0), "lFore": (1, 0, 0), "lHand": (1, 0, 0), "rUpper": (-1, 0, 0), "rFore": (-1, 0, 0), "rHand": (-1, 0, 0),
         "lThigh": (0, -1, 0), "lCalf": (0, -1, 0), "rThigh": (0, -1, 0), "rCalf": (0, -1, 0),
         "lFoot": (0, -0.35, 0.94), "rFoot": (0, -0.35, 0.94), "lToe": (0, 0, 1), "rToe": (0, 0, 1),
         "spine": (0, 1, 0), "spine1": (0, 1, 0), "spine2": (0, 1, 0), "neck": (0, 1, 0), "head": (0, 1, 0),
         "lClav": (1, 0, 0), "rClav": (-1, 0, 0), "lHand": (1, 0, 0), "rHand": (-1, 0, 0)}


def swing(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    a /= np.linalg.norm(a); b /= np.linalg.norm(b)
    c = np.cross(a, b); s = np.linalg.norm(c); d = np.dot(a, b)
    if s < 1e-8:
        if d > 0: return R.identity()
        ax = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        return R.from_rotvec(ax / np.linalg.norm(ax) * np.pi)
    return R.from_rotvec(c / s * np.arctan2(s, d))


def basis_rot(up, left):
    """rotation taking the canonical frame (left=+X, up=+Y) onto the given frame"""
    y = up / np.linalg.norm(up); x = left - y * np.dot(left, y); x /= np.linalg.norm(x); z = np.cross(x, y)
    return R.from_matrix(np.stack([x, y, z], axis=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp"); ap.add_argument("out")
    ap.add_argument("--ref", default="frame0")
    ap.add_argument("--from", dest="t0", type=float, default=0); ap.add_argument("--to", dest="t1", type=float, default=1e9)
    ap.add_argument("--scale", type=float, default=0.01)
    ap.add_argument("--step", type=int, default=0, help="keep every Nth frame (0 = auto: down to <= 60 fps)")
    a = ap.parse_args()
    b = load(a.inp)
    N = b["names"]
    J = {}
    names = dict(NAMES)
    if "LowerBack" in N:  # CMU (cgspeed BVH): LowerBack -> Spine -> Spine1 -> Neck -> Neck1 -> Head
        names.update(spine=["LowerBack"], spine1=["Spine"], spine2=["Spine1"], neck=["Neck"], head=["Head"])
    for k in KEYS:
        for n in names[k]:
            if n in N: J[k] = N.index(n); break
        else:
            raise SystemExit(f"no joint for {k}")
    fps = b["fps"]
    step = a.step or max(1, fps // 60)
    f0, f1 = int(a.t0 * fps), min(len(b["data"]), int(a.t1 * fps))
    frames = list(range(f0, f1, step))
    fps = fps / step
    # reference pose
    if a.ref == "rest":
        # zero rotations; position channels replaced by the joint offsets (Bandai-Namco style files)
        bb = dict(b); z = np.zeros((1, b["data"].shape[1])); col = 0
        for j, ch in enumerate(b["channels"]):
            for c in ch:
                if c.endswith("position"):
                    z[0, col] = b["offsets"][j]["XYZ".index(c[0])]
                col += 1
        bb["data"] = z
        rp, rr = fk(bb)
    else:
        rp, rr = fk(b, [0])
    pos, gr = fk(b, frames)
    # heading normalisation from the reference hips
    left = rp[0, J["lThigh"]] - rp[0, J["rThigh"]]; left[1] = 0; left /= np.linalg.norm(left)
    yaw = np.arctan2(left[2], left[0])  # angle of left from +X toward +Z
    W = R.from_rotvec([0, yaw, 0])  # rotate world so that left -> +X
    # (rotation about +Y by +yaw maps (cos,0,sin)*... check below)
    if np.linalg.norm(W.apply(left) - [1, 0, 0]) > 1e-3:
        W = R.from_rotvec([0, -yaw, 0])
    assert np.linalg.norm(W.apply(left) - [1, 0, 0]) < 1e-3
    s = a.scale
    RP = W.apply(rp[0]) * s
    refQ = {}
    refDir = {}
    for k in KEYS:
        q = W * rr[J[k]][0]
        if k == "hips":
            up = RP[J["spine"]] - RP[J["hips"]]
            if np.linalg.norm(up) < 1e-3: up = RP[J["spine1"]] - RP[J["hips"]]
            lf = RP[J["lThigh"]] - RP[J["rThigh"]]
            corr = basis_rot(np.array([0, 1.0, 0]), np.array([1.0, 0, 0])) * basis_rot(up, lf).inv()
            refQ[k] = corr * q; refDir[k] = [0, 1, 0]; continue
        c = CHILD[k]
        if c is not None:
            d = RP[J[c]] - RP[J[k]]
        else:
            # leaf: continue the parent's direction
            p = [kk for kk, cc in CHILD.items() if cc == k][0]
            d = RP[J[k]] - RP[J[p]]
        ideal = IDEAL.get(k)
        tgt = np.array(ideal, float) if ideal is not None else d
        if np.linalg.norm(d) < 1e-6: d = tgt.copy()
        refQ[k] = swing(d, tgt) * q
        refDir[k] = (tgt / np.linalg.norm(tgt)).round(5).tolist()
    nf = len(frames)
    out = []
    P = np.einsum('ij,fkj->fki', W.as_matrix(), pos) * s
    hips = P[:, J["hips"]]
    rows = [hips]
    for k in KEYS:
        D = (W * gr[J[k]]) * refQ[k].inv()
        qq = D.as_quat()  # x y z w
        # keep quaternion sign continuous
        for i in range(1, nf):
            if np.dot(qq[i], qq[i - 1]) < 0: qq[i] = -qq[i]
        rows.append(qq)
    for k in ["lFoot", "rFoot", "lToe", "rToe"]:
        rows.append(P[:, J[k]])
    arr = np.concatenate(rows, axis=1).astype(np.float32)
    leg = np.linalg.norm(RP[J["lThigh"]] - RP[J["lCalf"]]) + np.linalg.norm(RP[J["lCalf"]] - RP[J["lFoot"]])
    hipOff = (0.5 * (RP[J["lThigh"]] + RP[J["rThigh"]]) - RP[J["hips"]])
    # express in the canonical hips frame
    hipOff = (refQ["hips"] * (W * rr[J["hips"]][0]).inv()).apply(hipOff)
    hdr = dict(hipOff=hipOff.round(5).tolist(), src=a.inp.rsplit('/', 1)[-1], fps=fps, t0=a.t0, frames=nf, keys=KEYS, stride=arr.shape[1], refDir=refDir, legLen=float(leg),
               ankleY=float(min(RP[J["lFoot"]][1], RP[J["rFoot"]][1])))
    json.dump(hdr, open(a.out + ".json", "w"))
    arr.tofile(a.out + ".bin")
    print(a.out, nf, "frames", fps, "fps", arr.shape, "leg", round(leg, 3))


if __name__ == "__main__":
    main()
