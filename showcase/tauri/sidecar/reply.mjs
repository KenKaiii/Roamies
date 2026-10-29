// Turns the agent's raw text stream into what the sidekick shows and does.
// - Emote tags like [hype] (anywhere, even split across chunks) become emote events and are removed.
// - A later turn that only repeats the previous turn's text (models do this after a tool call) is dropped.
// - Text from a new turn is separated from earlier text with a space.
export const EMOTES = ['hype', 'upset', 'remind', 'motivate', 'wave'];
const TAG = new RegExp(`\\[(${EMOTES.join('|')})\\]\\s*`, 'i');
const LONGEST = Math.max(...EMOTES.map((e) => e.length)) + 2;

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export class ReplyStream {
  constructor(emit) {
    this.emit = emit; // ({ type: 'text', text } | { type: 'emote', action })
    this.pending = ''; // raw text that might still be the start of a tag
    this.turn = ''; // this turn's visible text so far
    this.held = ''; // visible text held back while it matches the previous turn
    this.prev = ''; // previous turn's visible text, normalised
    this.shown = false; // anything shown yet in this run
    this.started = false; // this turn has released text
  }

  push(delta) {
    this.pending += delta;
    for (;;) {
      const m = TAG.exec(this.pending);
      if (!m) break;
      this.visible(this.pending.slice(0, m.index));
      this.emit({ type: 'emote', action: m[1].toLowerCase() });
      this.pending = this.pending.slice(m.index + m[0].length);
    }
    // Hold back a trailing "[hyp" that could still become a tag.
    const open = this.pending.lastIndexOf('[');
    let keep = '';
    if (open >= 0 && this.pending.length - open <= LONGEST) {
      const tail = this.pending.slice(open + 1).toLowerCase();
      if (!tail.includes(']') && EMOTES.some((e) => e.startsWith(tail))) keep = this.pending.slice(open);
    }
    this.visible(this.pending.slice(0, this.pending.length - keep.length));
    this.pending = keep;
  }

  visible(text) {
    if (!text) return;
    this.turn += text;
    if (this.prev && !this.started) {
      // Still matching what was said last turn: hold it until it diverges.
      if (this.prev.startsWith(norm(this.turn))) { this.held += text; return; }
      text = this.held + text;
      this.held = '';
    }
    this.release(text);
  }

  release(text) {
    if (!this.started) {
      text = text.replace(/^\s+/, '');
      if (!text) return;
      if (this.shown) text = ' ' + text;
      this.started = true;
    }
    this.shown = true;
    this.emit({ type: 'text', text });
  }

  /** Call at each turn boundary (after the model's message and its tool results). */
  endTurn() {
    this.flushPending();
    // Whatever is still held only repeated the previous turn, so it is dropped.
    this.held = '';
    if (norm(this.turn)) this.prev = norm(this.turn);
    this.turn = '';
    this.started = false;
  }

  finish() { this.flushPending(); this.held = ''; }

  flushPending() {
    if (this.pending) { const p = this.pending; this.pending = ''; this.visible(p); }
  }
}
