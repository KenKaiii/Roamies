// Live conversation: what starts and ends it, and what the model is told. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIVE_WAIT, liveLine, saysGoodbye, wantsLive } from '../live.mjs';

for (const t of ["Let's talk", "let’s talk about my week", 'Live mode', 'Okay, start a conversation', 'Talk to me', 'can we chat?', "Hey, let's have a chat"]) assert.ok(wantsLive(t), `starts: ${t}`);
for (const t of ['What time is it?', 'Tell me about live music', 'Remind me to talk to Sam', "I'd talk to the bank"]) assert.ok(!wantsLive(t), `doesn't start: ${t}`);

for (const t of ['Bye', 'bye!', 'Okay thanks, bye.', 'Goodbye Jarvis', "That's all for now", 'thanks that’s all', "We're done", 'Stop talking', 'see you later', 'Good night', 'ok cool see ya', 'Bye bye']) assert.ok(saysGoodbye(t), `ends: ${t}`);
for (const t of ['How do I say bye in French?', 'Say goodbye to my mum for me', "That's all I need to know about Rome, what about Paris?", 'Later today remind me', 'Stop the timer', '']) assert.ok(!saysGoodbye(t), `doesn't end: ${t}`);

assert.equal(liveLine(null), '');
assert.equal(liveLine({ on: false }), '');
assert.match(liveLine({ on: true }), /Live conversation: on/);
assert.match(liveLine({ on: true }), /not a report/);
assert.doesNotMatch(liveLine({ on: true }), /goodbye: say/);
assert.match(liveLine({ on: true, ending: true }), /short, warm goodbye/);
assert.ok(LIVE_WAIT >= 3 && LIVE_WAIT <= 15, 'within what the voice helper allows');
// The wiring: what starts it, keeps it listening, and ends it, across the sidecar, the voice bridge and the overlay.
{
  const rd = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const side = rd('../sidekick.mjs'), rust = rd('../../src-tauri/src/voice.rs'), host = rd('../../../roamies/host.js'), agent = rd('../../../roamies/agent.js');
  assert.match(side, /m\.mode === 'wake'\) startLive\('wake'\)/, 'the wake word starts it');
  assert.match(side, /!live\.on && wantsLive\(m\.text\)\) startLive\('asked'\)/, "so does \"let's talk\"");
  assert.match(side, /live\.on && saysGoodbye\(m\.text\)\) live\.ending = true/, 'goodbye ends it after one last reply');
  assert.match(side, /const liveNext = live\.on && !live\.ending && byVoice/, 'it listens again after each spoken reply');
  assert.match(side, /wait: live\.on \? LIVE_WAIT/, 'for the live wait');
  assert.match(side, /endLive\('esc'\)/, 'Esc ends it');
  assert.match(side, /m\.code === 'nothing_heard' && live\.on\) \{ endLive\('quiet'\)/, 'silence ends it');
  assert.match(side, /\$\{liveLine\(live\)\}/, 'the model is told');
  assert.match(side, /if \(notReady\) \{ endLive\('not ready'\)/, 'a request that cannot run ends it');
  assert.match(side, /Date\.now\(\) - live\.last > LIVE_IDLE\) endLive\('idle'\)/, 'and so does a minute of nothing');
  assert.match(side, /if \(busy \|\| voiceBusy \|\| saidPending\) live\.last = Date\.now\(\)/, 'a reply still being said is not nothing going on');
  const panel = rd('../../../panel/panel.js');
  assert.match(panel, /toggle\('Live conversation', needs\(v\.wake \? 'Say the wake word/, 'the wake word is offered wherever there is one, not only on a Mac');
  assert.match(rust, /"type": "voice_state", "state": msg\.get\("state"\), "mode": msg\.get\("mode"\)/, 'the bridge passes the listen mode on');
  assert.match(host, /m\.kind === 'live'/, 'the overlay hears about it');
  assert.match(host, /ghost: !!Roamie\.liveSpoken/, 'spoken replies are ghosted');
  assert.match(agent, /const drawBubble = \(ctx, bb\) => \{\s*if \(bb\.ghost\) return;/, 'a ghost bubble is not drawn');
  assert.match(agent, /b\.ghost = b\.kind === 'speech' && !!opts\.ghost/, 'only speech, never a prompt or an error');
}
console.log('live conversation tests: passed');
