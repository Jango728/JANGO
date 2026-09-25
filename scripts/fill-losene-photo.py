import json
import urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
url='https://www.sherdog.com/image_crop/200/300/_images/fighter/1710218038036_20230120051306_Losene_Keita.JPG'
target=root/'public'/'fighters'/'sherdog-losene-keita.jpg'
target.write_bytes(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'JangoPlayz/1.0'}),timeout=30).read())
path=root/'lib'/'seed.json';seed=json.loads(path.read_text());fighter=seed['fighters']['losene-keita']
fighter['image']='/fighters/sherdog-losene-keita.jpg';fighter['imageDate']='2026-09-23';fighter['imageSource']=url
path.write_text(json.dumps(seed,indent=2,ensure_ascii=False)+'\n')
print(target,target.stat().st_size)
