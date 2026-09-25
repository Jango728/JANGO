"""Turn dist/ into publish/index.html (page body for the artifact host) + publish/files-map.json."""
import json, os, re
dist = 'dist'
html = open(f'{dist}/index.html').read()
css = re.search(r'href="\./(assets/[^"]+\.css)"', html).group(1)
js = re.search(r'src="\./(assets/[^"]+\.js)"', html).group(1)
page = f'''<title>Jango Playz</title>
<meta name="description" content="UFC and DWCS fight predictions from records, opposition quality, size, style and form. Odds shown, never used.">
<link rel="icon" href="favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800;900&display=swap">
<style>
{open(f"{dist}/{css}").read()}
</style>
<div id="root"></div>
<script type="module" src="{js}"></script>
'''
os.makedirs('publish', exist_ok=True)
open('publish/index.html', 'w').write(page)
m = {}
for root, _, fs in os.walk(dist):
    for f in fs:
        rel = os.path.relpath(os.path.join(root, f), dist)
        if rel == 'index.html' or rel.endswith('.css') or rel.endswith('SOURCES.txt'): continue
        m[rel] = rel
json.dump(m, open('publish/files-map.json', 'w'))
print(len(m), 'files', js)
