import numpy as np, re
from scipy.spatial.transform import Rotation as R

def load(path):
    txt = open(path).read()
    head, motion = txt.split('MOTION')
    names, parents, offsets, channels = [], [], [], []
    stack = []
    toks = head.split()
    i = 0
    cur = -1
    while i < len(toks):
        t = toks[i]
        if t in ('ROOT', 'JOINT'):
            names.append(toks[i + 1]); parents.append(stack[-1] if stack else -1); cur = len(names) - 1; offsets.append(None); channels.append([]); i += 2
        elif t == 'End':
            names.append(names[stack[-1]] + '_end'); parents.append(stack[-1]); cur = len(names) - 1; offsets.append(None); channels.append([]); i += 2
        elif t == '{':
            stack.append(cur); i += 1
        elif t == '}':
            stack.pop(); i += 1
        elif t == 'OFFSET':
            offsets[cur] = np.array([float(x) for x in toks[i + 1:i + 4]]); i += 4
        elif t == 'CHANNELS':
            n = int(toks[i + 1]); channels[cur] = toks[i + 2:i + 2 + n]; i += 2 + n
        else:
            i += 1
    lines = motion.strip().split('\n')
    nf = int(lines[0].split()[1]); ft = float(lines[1].split()[2])
    data = np.array([[float(x) for x in l.split()] for l in lines[2:2 + nf]])
    return dict(names=names, parents=parents, offsets=np.array(offsets), channels=channels, data=data, fps=round(1 / ft))

def fk(b, frames=None):
    data = b['data'] if frames is None else b['data'][frames]
    nf = len(data); nj = len(b['names'])
    pos = np.zeros((nf, nj, 3)); rot = [None] * nj
    col = 0
    locr = []; loct = []
    for j in range(nj):
        ch = b['channels'][j]
        t = np.tile(b['offsets'][j], (nf, 1))
        r = R.identity(nf)
        if ch:
            vals = data[:, col:col + len(ch)]; col += len(ch)
            rc = [c for c in ch if c.endswith('rotation')]
            ri = [k for k, c in enumerate(ch) if c.endswith('rotation')]
            pi = [k for k, c in enumerate(ch) if c.endswith('position')]
            if pi: t = vals[:, pi]
            if rc:
                order = ''.join(c[0] for c in rc).upper()
                r = R.from_euler(order, vals[:, ri], degrees=True)
        locr.append(r); loct.append(t)
    gr = [None] * nj
    for j in range(nj):
        p = b['parents'][j]
        if p < 0:
            gr[j] = locr[j]; pos[:, j] = loct[j]
        else:
            gr[j] = gr[p] * locr[j]; pos[:, j] = pos[:, p] + gr[p].apply(loct[j])
    return pos, gr

def idx(b, n):
    return b['names'].index(n)
