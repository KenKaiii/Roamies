// Five takes on the dither blob: new palettes, patterns and one physical difference each.
[
  { id: 'dither-amber', label: 'Amber CRT blob', pattern: 'lines', scan: 0.7, glow: 0.6, antenna: true,
    pal: [[18, 7, 0], [84, 34, 0], [178, 92, 6], [245, 164, 40], [255, 226, 150]] },
  { id: 'dither-frost', label: 'Frost bear blob', pattern: 'bayer8', pixel: 0.75, ears: true, grid: 'rgba(8,16,32,0.22)',
    pal: [[8, 16, 32], [34, 64, 104], [96, 150, 200], [184, 226, 248], [240, 250, 255]] },
  { id: 'dither-sakura', label: 'Sakura cyclops blob', pattern: 'dots', eye: 'cyclops',
    pal: [[42, 14, 30], [122, 44, 82], [226, 108, 150], [255, 184, 206], [255, 240, 246]] },
  { id: 'dither-led', label: 'LED matrix blob', matrix: true, pixel: 1.3, drip: true, glow: 0.55, speed: 80,
    pal: [[4, 16, 18], [14, 92, 96], [40, 196, 184], [120, 255, 226], [230, 255, 250]] },
  { id: 'dither-void', label: 'Void visor blob', pattern: 'bayer8', eye: 'visor', pixel: 1.35, glow: 0.35, grid: 'rgba(12,4,24,0.25)',
    pal: [[12, 4, 24], [52, 18, 92], [130, 46, 196], [222, 98, 255], [255, 214, 255]] },
].forEach((v) => Roamie.register(Roamie.ditherKit(v)));
