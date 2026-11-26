---
name: correct-draw-syntax
description: Exact verified JSON schemas for every mark kind supported by the Roamies draw tool.
---

# Roamies Overlay Drawing Syntax

Every `draw` call takes `{ beats: [{ say: "Short spoken caption under 20 words", marks: [ ... ], wait?: "click" | "hover" }] }`.
Every card mark MUST include a concise 2–4 word `title` (never generic `"Table"`, `"List"`, or `"Answer"`).
Valid `tone` values ONLY: `"accent"`, `"teal"`, `"amber"`, `"coral"`, `"lilac"`, `"sky"`, `"lime"`, `"red"`, `"white"`.

## 1. Checklists & Task Lists (`list`)
```json
{ "kind": "list", "title": "Morning Checklist", "items": ["Item 1", "Item 2", "Item 3"] }
```

## 2. Structured Explanation Cards (`card`) & Notes (`note`)
```json
{ "kind": "card", "title": "Server Latency", "heading": "Why p99 Spiked", "text": "Connection pool exhaustion under burst traffic.", "items": ["Increase max pool size", "Add request timeout"], "sources": [{ "name": "Docs", "url": "https://example.com" }] }
```
```json
{ "kind": "note", "title": "Quick Reminder", "text": "Check deployment logs after 5 PM." }
```

## 3. Data Tables (`table`)
```json
{ "kind": "table", "title": "GPU Comparison", "columns": ["Model", "VRAM", "NVLink"], "rows": [["RTX 4090", "24 GB", "no"], ["H100", "80 GB", "yes"]] }
```

## 4. Metric Bars (`bars`) & Line Graphs (`graph`)
```json
{ "kind": "bars", "title": "Monthly Revenue", "unit": "\$k", "bars": [{ "label": "Jan", "value": 12, "tone": "teal" }, { "label": "Feb", "value": 19, "tone": "accent" }] }
```
```json
{ "kind": "graph", "title": "Growth Curve", "x_range":, "y_range":, "plots": [{ "label": "Users", "tone": "accent", "points": [[0, 5], [5, 40], [10, 95]] }], "dots": [{ "x": 5, "y": 40, "label": "Launch" }] }
```

## 5. Process & Logic Flows (`flow`) & Mind Maps (`mindmap`)
```json
{ "kind": "flow", "title": "Auth Pipeline", "dir": "right", "animate": true, "nodes": [{ "id": "1", "text": "Login", "shape": "round", "tone": "teal" }, { "id": "2", "text": "Verify JWT", "shape": "diamond", "tone": "amber" }], "links": [{ "from": "1", "to": "2", "label": "token", "flow": true }] }
```
```json
{ "kind": "mindmap", "title": "System Architecture", "branches": [{ "text": "Frontend", "tone": "teal", "items": ["Tauri", "Canvas UI"] }, { "text": "Sidecar", "tone": "lilac", "items": ["Node.js", "Tools"] }] }
```

## 6. Timelines (`timeline`)
```json
{ "kind": "timeline", "title": "Release History", "events": [{ "when": "2025 Q4", "text": "Initial prototype" }, { "when": "2026 Q2", "text": "Public launch" }] }
```

## 7. Interactive Targets (`target`) & Action Buttons (`button`)
```json
{ "kind": "target", "at": { "text": "Export" }, "label": "Click Export" }
```
```json
{ "kind": "button", "label": "Open Docs", "action": { "do": "open", "value": "https://example.com" } }
```

## 8. Photos (`photo`)
```json
{ "kind": "photo", "title": "Golden Gate Bridge", "query": "Golden Gate Bridge", "text": "Suspension bridge in San Francisco" }
```

## 9. Math Steps (`math`), Geometry (`geometry`), & Molecules (`molecule`)
```json
{ "kind": "math", "title": "Quadratic Formula", "steps": [{ "tex": "x^2 - 5x + 6 = 0", "note": "Start equation" }, { "tex": "(x - 2)(x - 3) = 0", "note": "Factor" }] }
```
```json
{ "kind": "geometry", "title": "Right Triangle", "vertices": [{ "id": "A", "x": 0, "y": 0 }, { "id": "B", "x": 4, "y": 0 }, { "id": "C", "x": 0, "y": 3 }], "lines": [{ "from": "A", "to": "B", "label": "4" }, { "from": "B", "to": "C", "label": "5" }, { "from": "C", "to": "A", "label": "3" }], "angles": [{ "at": "A", "from": "B", "to": "C", "label": "90°" }] }
```
```json
{ "kind": "molecule", "title": "Caffeine", "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "label": "Caffeine" }
```

## 10. Regional Maps (`map`)
```json
{ "kind": "map", "title": "Flight Route", "region": "world", "shade": [{ "name": "Japan", "tone": "teal" }], "pins": [{ "name": "MSP", "lat": 44.88, "lon": -93.22 }, { "name": "NRT", "lat": 35.76, "lon": 140.39 }], "routes": [{ "from": "MSP", "to": "NRT", "tone": "accent" }] }
```

## 11. 3D Models (`model`) & Quizzes (`quiz`)
```json
{ "kind": "model", "title": "Simple Rotor", "parts": [{ "shape": "cylinder", "at":, "size":, "rot":, "tone": "teal", "label": "Shaft", "motion": { "do": "spin", "axis": "y", "secs": 4 } }] }
```
```json
{ "kind": "quiz", "title": "Quick Check", "questions": [{ "text": "Which planet is closest to the Sun?", "options": ["Venus", "Mercury", "Mars"], "answer": "Mercury", "explain": "Mercury orbits closest to the Sun." }] }
```
