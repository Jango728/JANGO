# New-fighter data spec (nightly 2026-09-26)

Output: write ONE JSON file `~/jango/data/research/new-2026-09-26/<batch>.json`:
{ "fighters": { "<id>": Fighter, ... }, "gaps": ["free-text notes on anything unverified"] }

id = lowercase ascii slug of the name, hyphens (e.g. "christian-leroy-duncan", "kai-kamaka-iii", "allen-frye-jr").

Fighter fields (omit a field if unverified — NEVER invent):
- id, name (as UFC.com / promotion bills it), nickname?
- record: "W-L-D" pro MMA record (Tapology), recordScope: "Professional MMA (Tapology, checked 2026-09-26)"
- birthDate "YYYY-MM-DD", country (nationality / fighting out of country), stance ("Orthodox"/"Southpaw"/"Switch")
- height: CENTIMETRES (number, e.g. 6'1" -> 185.42), reach: CENTIMETRES (inches*2.54)
- profile: Tapology fighter URL; tapology: same URL
- history: array of ALL pro MMA bouts, NEWEST FIRST. Each row:
  { "opponent": str, "date": "YYYY-MM-DD", "result": "W"|"L"|"D"|"NC",
    "promotion": short name ("UFC", "DWCS" for Dana White's Contender Series, "PFL", "Bellator", "LFA", "Cage Warriors", "ACA", "KSW", "OKTAGON", else the org name from Tapology),
    "eventName": str, "method": e.g. "KO/TKO (Punches)", "Submission (Rear-Naked Choke)", "Decision (Unanimous)", "Decision (Split)", "Draw (Majority)", "No Contest",
    "round": int, "time": "m:ss", "minutes": total elapsed minutes as number = (round-1)*5 + time (use 3-min rounds only if Tapology says so),
    "rules": "MMA", "division": e.g. "Lightweight" (if shown),
    "opponentRecord": "W-L-D" opponent record BEFORE that fight as shown on Tapology (omit if not shown), "opponentRecordBasis": "reported",
    "source": Tapology bout or event URL (or the fighter page URL) }
  Exclude amateur, exhibition, kickboxing/boxing bouts. Include the fight results up to today (2026-09-26).
- historyComplete: true only if every pro bout matching `record` is present (count W/L/D rows = record). ufcHistoryComplete: true if all UFC/DWCS bouts present.
- historySource: Tapology URL, historyChecked: "2026-09-26"
- sources: [{label, url, checked:"2026-09-26"}] for each page used
- image: "fighters/<id>.webp" ONLY if you saved a real transparent UFC.com portrait (see below); imageSource: the UFC.com athlete URL; imageDate "2026-09-26"
- recordNote: one sentence on sources/discrepancies.

Tools: Firecrawl only (ToolSearch "select:mcp__Firecrawl__firecrawl_scrape,mcp__Firecrawl__firecrawl_search,mcp__Firecrawl__firecrawl_interact"). Direct curl to these sites is blocked. Tapology fighter pages scrape fine via firecrawl_scrape (formats markdown, onlyMainContent false may be needed for the full results list; the "Pro MMA record" section lists each bout with opponent, opponent record at the time, method, round, time, date, event, promotion). Find Tapology URLs via firecrawl_search "site:tapology.com <name>". Firecrawl rate-limits (~11 req/min): on 429 wait and retry.

Portrait (UFC fighters only; optional for others if they have a UFC.com athlete page): run firecrawl_interact with url "https://www.ufc.com/athletes", language "node", timeout 120, code like:
  const slugs=['mike-malott']; const out={};
  for (const s of slugs){ out[s]=await page.evaluate(async (s)=>{ const h=await (await fetch('/athlete/'+s)).text();
    const m=h.match(/https?:\/\/[^"' ]*athlete_bio_full_body[^"' ]*/); if(!m) return {err:'noimg'};
    const url=m[0].replace(/&amp;/g,'&'); if(url.includes('SHADOW')) return {err:'shadow'};
    const u=new URL(url,location.origin); const b=await (await fetch(u.pathname+u.search)).blob(); const bmp=await createImageBitmap(b);
    const sc=Math.min(1,640/bmp.height); const c=document.createElement('canvas'); c.width=Math.round(bmp.width*sc); c.height=Math.round(bmp.height*sc);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height); return {url, data:c.toDataURL('image/webp',0.85)}; }, s); }
  console.log(JSON.stringify(out));
Reuse the returned scrapeId for further calls (pass scrapeId instead of url) and call firecrawl_interact_stop when done. Do 2 fighters per call. If the output is saved to a file, decode it with python. Save the decoded bytes to ~/jango/public/fighters/<id>.webp (verify with python PIL that mode is RGBA and it opens). SKIP if the image URL contains SHADOW or none found — then leave `image` unset. Never use a silhouette.
The UFC.com athlete page (same fetch, parse the HTML text) also shows Height/Reach/Age/Place of birth/Fighting style in the bio block — useful cross-check for height/reach. Slug is usually first-last (check /athlete/<slug>; try variants if 404).

Validate your JSON with python before finishing (json.load, each history row has required keys, record matches counts where historyComplete). Return a short summary: fighters done, portraits saved, gaps.
Do NOT modify any other files. Do not send messages to anyone.
