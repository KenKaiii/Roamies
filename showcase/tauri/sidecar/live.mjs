// Live conversation: one wake word ("Hey Jarvis") or "let's talk" starts a back-and-forth that needs no keys. After
// every reply the mic opens again by itself; it ends when they say goodbye, press Esc, or stop talking for a while.
// While it's on, replies are spoken like a conversation rather than read like a transcript (no captions on screen).

// How long the mic waits for them to start talking again after each reply (the voice helper allows 3 to 15 s).
export const LIVE_WAIT = 12;
// Nothing listening, thinking or being said for this long: the conversation is over.
export const LIVE_IDLE = 60_000;

const clean = (t) => String(t ?? '').toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

// "Let's talk", "live mode", "start a conversation", "talk to me", alone or as the start of what they say.
const START = /^(?:(?:hey|ok|okay|so)\s+)?(?:let's (?:talk|chat|have a (?:chat|conversation))|live (?:mode|conversation|chat)|(?:start|begin) (?:a |the )?(?:live )?(?:conversation|chat)|talk to me|can we (?:talk|chat))\b/;
export const wantsLive = (text) => START.test(clean(text));

// The whole of what they said is a goodbye: "bye", "ok thanks bye", "that's all for now", "stop talking", "we're done".
// Not "bye" inside a sentence ("how do I say bye in French").
const END = /^(?:(?:ok|okay|alright|right|thanks|thank you|cool|great|perfect|awesome|nice|that's it|yeah|yes|no|nope)\s+)*(?:bye|goodbye|good bye|bye bye|see you|see ya|see you later|talk later|talk to you later|later|that's all|that's all for now|that's it for now|that's everything|i'm done|we're done|done for now|end (?:the )?(?:conversation|chat|live mode)|stop (?:talking|listening|live mode)|exit live mode|good night|goodnight|cheers)(?:\s+(?:for now|then|now|thanks|thank you|bye|buddy|jarvis|mate))*$/;
export const saysGoodbye = (text) => END.test(clean(text));

/** The live-state line while a live conversation is on (empty otherwise). */
export function liveLine(live) {
  if (!live?.on) return '';
  return `- Live conversation: on. You're talking out loud with them, back and forth, and your words aren't shown on screen, only heard. Talk like a person, not a report: usually one or two short spoken sentences, react to what they just said, and ask back when it fits; give longer detail only when they ask for it. Cards and drawings still help when something is easier to see. No lists or markdown in what you say.${live.ending ? ' They just said goodbye: say a short, warm goodbye and nothing else.' : ''}\n`;
}
