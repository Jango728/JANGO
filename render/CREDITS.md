# Credits and licences — finish films (v2)

## Used in the v2 films

| Asset | Where | Licence |
|---|---|---|
| **CMU Graphics Lab Motion Capture Database** — takes 13_17, 13_18, 14_01, 14_02 (boxing), 07_01 (walk), 16_08 (run/stop), 77_02 (standing), 77_18 (lying down, getting up); cgspeed BVH conversion (B. Hahne), mirrored at github.com/una-dinosauria/cmu-mocap | `public/mo/cmu_*.{json,bin}` (converted by `tools/convert_bvh.py`) | Free for research and commercial use, no restrictions. Acknowledgement: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." |
| **Microsoft Rocketbox Avatar Library** — Sports_Male_01, Sports_Female_01, Security_Male_01 (referee), crowd avatars, cheer/clap animations | `public/rb`, `public/crowd`, `public/anims` | MIT |
| **Rapier** physics (`@dimforge/rapier3d-compat`, ragdoll) | `node_modules` | Apache-2.0 |
| **three.js** (renderer, GTAOPass, loaders) | parent project | MIT |

All sponsor/brand names on the canvas and banners are invented.

## Downloaded and evaluated but NOT used in the films

| Asset | Why not |
|---|---|
| Ubisoft La Forge Animation Dataset (LAFAN1), incl. `fight1_subject*`, `fallAndGetUp*` | Best raw quality, but licence is **CC BY-NC-ND 4.0** (no derivatives — retargeted, re-timed renders are adaptations). Converted files remain in `public/mo/` (non-`cmu_` names) for reference only; delete before any redistribution of the assets folder. |
| Bandai-Namco-Research motion dataset (`public/bvh/dataset-*`) | CC BY-NC-ND 4.0 as well; was the motion source of the v1 films. v2 no longer uses it. |
| MakeHuman data (makehuman-js/makehuman-data) | AGPL-derived licence and no ready rigged athlete; the Rocketbox body was sculpted instead. |
