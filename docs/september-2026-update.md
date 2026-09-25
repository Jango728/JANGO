# September 15 update

UFC 331 has 12 active bouts from the September 15 official listing. Moicano–Ortega was removed; Steveson–Sharaf moved to the main card. Main and co-main are both five rounds. DWCS season 10 week 6 has five three-round bouts, confirmed at the September 14 weigh-in.

The normalized source data and all selected portraits are checked into this repository. Athlete history/profile snapshots were collected September 14. Current UFC odds are a dated September 14 display-only snapshot; all three prediction functions ignore them. No automated live feed exists.

`archived-noche-forecast.json` is an immutable reproduction from the September 11 published source revision recorded inside it. It is not a personally locked forecast. Do not regenerate it with current data or models. Results: 7/12 supported winner picks, one abstention, 9/13 totals; always-Over baseline 11/13. `baseline-v6.json` supports safe migration of existing saved fighter edits and preservation of the old event context.

Rounds version 0.3 exposes last-10 duration rows and promotion splits and reduces the influence of non-UFC history when UFC evidence exists. No population heavyweight/organization KO prior or betting odds is used. These changes remain unvalidated on future events.

Human assets are Microsoft RocketBox MIT-licensed models; the license is shipped under public/models/rocketbox. They are generic athletic people, not actual fighter likenesses. Animation uses procedural choreography and fixed-length skeletal retargeting, not motion capture or a physics simulation. Reduced motion, offscreen pausing, seeking and orbit controls remain available. Node rig checks verify finite transforms, fixed forearm lengths and correct left/right mapping; there was no browser visual QA of the website in this update.

Official Pantoja–Asakura video metadata was inspected in YouTube, but the player remained black after seeking and playback attempts. No actual fight frames were analyzed. Footage links are explicitly unreviewed and excluded from the statistical score. Do not claim the model watched them.

Validation: core, rounds, finish, finish-transfer, september-update and cage-rig checks; TypeScript; Sites production build. `scripts/integrate-september.py` is a one-off normalization script that expects the external research snapshot folders; the resulting seed is the durable deliverable.
