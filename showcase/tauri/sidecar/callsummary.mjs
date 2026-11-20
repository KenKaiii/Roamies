// The end-of-call summary: one subject line and the main points, made on this computer (no network, no model): the words
// that come up most give the subject, the sentences that carry the most of them are the points. Only when the text makes
// sense: too short, mostly noise, or one phrase repeated over and over (what speech-to-text invents from silence) gets no summary.

const STOP = new Set(`a about above after again all also am an and any are as at be because been before being between both but by can could did do does doing
down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off
on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under
until up us very was we were what when where which while who whom why will with would you your yours yeah yes okay ok oh um uh like gonna wanna
got get going go know think really right well thing things one two see say said let lets dont doesnt didnt thats its im ive youre cant wont`.split(/\s+/));

// What Whisper-style engines write for silence or music.
const FILLER = /\b(thanks? for watching|thank you for watching|subtitles? by|please subscribe|like and subscribe|amara\.org|transcribed by)\b/i;

export const MIN_WORDS = 25;

const words = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);

/** { ok, reason } : does this text read like people talking about something? */
export function makesSense(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const w = words(t);
  if (w.length < MIN_WORDS) return { ok: false, reason: 'too short' };
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters / t.replace(/\s/g, '').length < 0.7) return { ok: false, reason: 'mostly not words' };
  if (new Set(w).size / w.length < 0.25) return { ok: false, reason: 'the same few words over and over' };
  const real = w.filter((x) => !STOP.has(x) && x.length > 2);
  if (real.length < 8) return { ok: false, reason: 'no real content' };
  const stripped = t.split(/(?<=[.!?])\s+/).filter((s) => !FILLER.test(s)).join(' ');
  if (words(stripped).length < MIN_WORDS) return { ok: false, reason: 'only filler' };
  return { ok: true, reason: '' };
}

const sentences = (text) => String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => words(s).length >= 4 && !FILLER.test(s));

/** { subject, points[] } for the entries of one call ([{ text }]), or null with a reason when the text doesn't make sense. */
export function summarizeCall(entries, { maxPoints = 4 } = {}) {
  const text = (entries ?? []).map((e) => String(e?.text ?? '')).join(' ');
  const sense = makesSense(text);
  if (!sense.ok) return { summary: null, reason: sense.reason };
  const freq = new Map();
  for (const w of words(text)) if (!STOP.has(w) && w.length > 2 && !/^\d+$/.test(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const top = [...freq].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([w]) => w);
  const subject = top.length ? `Call about ${top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top.at(-1)}` : top[0]}` : 'Call';
  const list = sentences(text);
  const score = (s) => { const w = words(s); return w.reduce((n, x) => n + (freq.get(x) ?? 0), 0) / Math.sqrt(w.length); };
  const picked = list.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v).slice(0, maxPoints).sort((a, b) => a.i - b.i);
  const points = picked.map(({ s }) => (s.length > 200 ? `${s.slice(0, 197)}…` : s));
  return { summary: { subject, points }, reason: '' };
}
