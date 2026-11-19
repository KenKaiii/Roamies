// Arabic replies: the font that draws them is bundled and declared in every page that shows text (desktop.html for the
// overlay, onboarding.css for the panel and setup guide), with its licence and credit. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const WOFF = 'onboarding/fonts/readex-pro-arabic.woff2';
assert.ok(fs.statSync(new URL(WOFF, root)).size > 10_000, 'the Arabic font file is bundled');
assert.ok(fs.statSync(new URL('onboarding/fonts/OFL-ReadexPro.txt', root)).size > 1000, 'with its licence text');
assert.match(fs.readFileSync(new URL('../THIRD_PARTY_NOTICES.md', root), 'utf8'), /Readex Pro/, 'and its credit');

for (const [file, url] of [['desktop.html', 'onboarding/fonts/readex-pro-arabic.woff2'], ['onboarding/onboarding.css', 'fonts/readex-pro-arabic.woff2']]) {
  const css = read(file);
  const face = (name) => new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${name}";[^}]*\\}`).exec(css)?.[0] ?? '';
  const letters = face('Clanky Arabic'), rtl = face('Clanky Arabic RTL');
  assert.ok(letters && rtl, `${file} declares both Arabic faces`);
  assert.ok(letters.includes(url) && rtl.includes(url), `${file}: both load the bundled file`);
  assert.ok(!/U\+0020/.test(letters), `${file}: the letters face leaves the space to Martian Mono`);
  assert.ok(/U\+0020/.test(rtl) && /U\+0600-06FF/.test(rtl), `${file}: the right-to-left face also takes the space`);
}
assert.match(read('onboarding/onboarding.css'), /--mono:\s*"Martian Mono",\s*"Clanky Arabic"/, 'the panel stack has the Arabic letters after Martian Mono');

// Where the overlay draws or lays out text, Arabic gets the font: canvas stacks and the card / capsule / ask bar rules.
const js = (f) => read(`clanky/${f}`);
for (const f of ['glass.js', 'ink.js', 'agent.js', 'agent-panel.js', 'agent-home.js', 'ask-bar.js', 'notch.js']) {
  assert.match(js(f), /"Martian Mono", "Clanky Arabic"/, `${f}: Arabic letters after Martian Mono`);
}
assert.match(js('core.js'), /R\.rtlFont = \(s, font\) => \(R\.rtl\(s\) \? String\(font\)\.replace\('"Martian Mono"', '"Clanky Arabic RTL", "Martian Mono"'\)/, 'right-to-left canvas text puts the Arabic face first');
assert.match(js('agent.js'), /const rf = R\.rtlFont\(line\.s, fontFor\(0\)\)/, 'the bubble draws Arabic lines with it');
assert.match(js('agent-panel.js'), /\.rp-body :dir\(rtl\) \{ font-family: "Clanky Arabic RTL"/, 'the card too, per paragraph');
assert.match(js('notch.js'), /\.nc-line:dir\(rtl\) \{ font-family: "Clanky Arabic RTL"/, 'and the capsule, per line');
assert.match(js('ask-bar.js'), /ta\.dir = 'auto'/, 'typing Arabic runs right to left');

console.log('arabic tests: passed');
