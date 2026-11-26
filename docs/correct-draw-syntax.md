---
name: correct-draw-syntax
description: Verified, strict JSON schemas for all 21 card kinds supported by the Roamies draw tool.
---

# Roamies Draw Tool Syntax (All 21 Card Kinds)

## CRITICAL EXECUTION RULES
1. **Invoke the `draw` tool directly.** NEVER output raw JSON or markdown code blocks in your spoken/text reply.
2. **Valid JSON only.** Every array and object must contain concrete values—never leave empty commas (`[,]`) or trailing commas.
3. **Top-level wrapper:**
   `{"keep":true,"beats":[{"say":"Short spoken summary under 20 words.","marks":[<CARD_OBJECT>]}]}`
4. **Never set `"wait"` on card beats.**
5. **NEVER include `"tie"` on cards** (cards auto-place themselves on calm screen space; `tie` fails unless that exact text already exists on screen).
6. **NEVER set `"deep": true`** when showing cards (omit `deep` completely so cards stay visible together instead of replacing one another).
5. **Default to simple cards when unsure:** Prefer `card`, `list`, `note`, or `table` unless the user specifically asks for charts, diagrams, 3D models, maps, math, or quizzes.
6. **Minimum item counts:** Always include **at least 2 items** in `timeline.events`, `bars.bars`, `flow.nodes`, `geometry.vertices`, and `mindmap.branches`.
7. **Geometry rule:** Every vertex `id` listed in `geometry.vertices` MUST be referenced in at least one entry in `geometry.lines`.
8. **Allowed `tone` values:** `"accent"`, `"teal"`, `"amber"`, `"coral"`, `"lilac"`, `"sky"`, `"lime"`, `"red"`, `"white"`.
9. **String IDs:** Always pass `id`, `from`, and `to` fields as quoted strings (e.g., `"1"`, `"A"`), never bare numbers.

## VERIFIED CARD SCHEMAS (1–21)

1. **`card`** (General structured summary)
   `{"kind":"card","title":"Server Latency","heading":"Why p99 Spiked","text":"Connection pool exhaustion under load.","items":["Increase pool size","Add request timeout"]}`

2. **`note`** (Short sticky note / reminder)
   `{"kind":"note","title":"Quick Reminder","text":"Check deployment logs at 5 PM."}`

3. **`list`** (Checklist or bulleted items)
   `{"kind":"list","title":"Morning Checklist","items":["Review PRs","Run test suite","Deploy staging"]}`

4. **`mindmap`** (Hierarchical branches; min 2 branches)
   `{"kind":"mindmap","title":"Architecture","branches":[{"text":"UI","tone":"teal","items":["Tauri","Canvas"]},{"text":"Core","tone":"lilac","items":["Node","Tools"]}]}`

5. **`clip`** (Highlighted quote or excerpt)
   `{"kind":"clip","title":"Key Quote","label":"Article","text":"Quoted excerpt text goes here."}`

6. **`sources`** (Clickable reference links)
   `{"kind":"sources","title":"Links","sources":[{"name":"GitHub","url":"https://github.com"}]}`

7. **`photo`** (Image search card)
   `{"kind":"photo","title":"Golden Gate","query":"Golden Gate Bridge","text":"San Francisco suspension bridge"}`

8. **`graph`** (2D line plot; `x_range` and `y_range` are 2-number arrays; `points` are `[x,y]` pairs)
   `{"kind":"graph","title":"User Growth","x_range":[0,10],"y_range":[0,100],"plots":[{"label":"Users","tone":"accent","points":[[0,10],[5,45],[10,90]]}]}`

9. **`legend`** (Color-coded key)
   `{"kind":"legend","title":"Priority Key","keys":[{"tone":"red","text":"High"},{"tone":"teal","text":"Low"}]}`

10. **`timeline`** (Chronological milestones; min 2 events)
    `{"kind":"timeline","title":"Roadmap","events":[{"when":"2025 Q4","text":"Prototype"},{"when":"2026 Q2","text":"Launch"}]}`

11. **`molecule`** (Chemical structure via SMILES)
    `{"kind":"molecule","title":"Ethanol","smiles":"CCO","label":"Ethanol"}`

12. **`model`** (3D primitive scene; `at`, `size`, and `rot` are 3-number `[x,y,z]` arrays)
    `{"kind":"model","title":"Rotor","parts":[{"shape":"cylinder","at":[0,0,0],"size":[1,2,1],"rot":[0,0,0],"tone":"teal","label":"Shaft","motion":{"do":"spin","axis":"y","secs":4}}]}`

13. **`flow`** (Directed node graph; min 2 nodes; string IDs)
    `{"kind":"flow","title":"Auth Flow","dir":"right","animate":true,"nodes":[{"id":"1","text":"Login","shape":"round","tone":"teal"},{"id":"2","text":"Verify","shape":"diamond","tone":"amber"}],"links":[{"from":"1","to":"2","label":"JWT","flow":true}]}`

14. **`table`** (Rows and columns; each row length must match `columns` length)
    `{"kind":"table","title":"GPU Specs","columns":["Model","VRAM","NVLink"],"rows":[["RTX 4090","24 GB","No"],["H100","80 GB","Yes"]]}`

15. **`bars`** (Bar chart; min 2 bars; numeric `value`)
    `{"kind":"bars","title":"Revenue","unit":"USD","bars":[{"label":"Jan","value":12,"tone":"teal"},{"label":"Feb","value":19,"tone":"accent"}]}`

16. **`map`** (Geographic map with shaded regions, `[lat,lon]` pins, and routes)
    `{"kind":"map","title":"Flight Route","region":"world","shade":[{"name":"Japan","tone":"teal"}],"pins":[{"name":"MSP","lat":44.88,"lon":-93.22},{"name":"NRT","lat":35.76,"lon":140.39}],"routes":[{"from":"MSP","to":"NRT","tone":"accent"}]}`

17. **`math`** (Step-by-step LaTeX equations)
    `{"kind":"math","title":"Quadratic","steps":[{"tex":"x^2 - 5x + 6 = 0","note":"Start"},{"tex":"(x-2)(x-3)=0","note":"Factor"}]}`

18. **`geometry`** (2D vertices and edges; min 2 vertices; all vertices must connect via `lines`)
    `{"kind":"geometry","title":"Triangle","vertices":[{"id":"A","x":0,"y":0},{"id":"B","x":4,"y":0},{"id":"C","x":0,"y":3}],"lines":[{"from":"A","to":"B","label":"4"},{"from":"B","to":"C","label":"5"},{"from":"C","to":"A","label":"3"}]}`

19. **`quiz`** (Multiple-choice check; `answer` must exactly match one string in `options`)
    `{"kind":"quiz","title":"Quick Check","questions":[{"text":"Closest planet to Sun?","options":["Venus","Mercury","Mars"],"answer":"Mercury","explain":"Mercury orbits closest to the Sun."}]}`

20. **`ticket`** (Actionable command/copy card)
    `{"kind":"ticket","title":"Deploy Build","n":1,"text":"Run release script.","label":"Run","action":{"do":"copy","value":"./build.sh"}}`

21. **`medal`** (Achievement / completion badge)
    `{"kind":"medal","title":"Milestone","text":"All 21 card types verified!"}`

### 3D Model (`model`)
```json
{"beats":[{"say":"Spinning 3D cube.","marks":[{"kind":"model","title":"3D Cube","parts":[{"shape":"box","at":[0,0,0],"size":[1.4,1.4,1.4],"tone":"teal","motion":{"do":"spin","axis":"y","secs":4}}]}]}],"keep":true}
```
