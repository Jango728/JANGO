#!/usr/bin/env python3
"""Convert only live portrait assets to compact WebP and prune unused portraits."""
import json
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
seed_path=root/'lib'/'seed.json';seed=json.loads(seed_path.read_text())
portrait_dir=root/'public'/'fighters';keep=set()
for fighter in seed['fighters'].values():
 image=fighter.get('image')
 if not image or not image.startswith('/fighters/'): continue
 source=root/'public'/image.lstrip('/')
 if not source.exists(): continue
 target=source.with_suffix('.webp')
 try:
  subprocess.run(['convert',str(source),'-strip','-resize','600x800>','-quality','78',str(target)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 except subprocess.CalledProcessError:
  keep.add(source.resolve())
  continue
 if target.stat().st_size<1000:
  target.unlink(missing_ok=True);keep.add(source.resolve());continue
 fighter['image']='/fighters/'+target.name;keep.add(target.resolve())
for path in portrait_dir.iterdir():
 if path.is_file() and path.resolve() not in keep: path.unlink()
seed_path.write_text(json.dumps(seed,indent=2,ensure_ascii=False)+'\n')
print(f'Kept {len(keep)} optimized portraits.')
