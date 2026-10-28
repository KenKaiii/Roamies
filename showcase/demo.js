// Scripted session so the sidekick's agent states can be seen without a model attached.
// window.sidekick is the live agent API, e.g. sidekick.say('hi'), sidekick.think('hmm', { dur: 2 }),
// sidekick.tool('read', { variant: 'many', detail: 'src/' }). ?scene=tools jumps straight to tool calls.
(() => {
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const qs = new URLSearchParams(location.search);
  const boot = () => {
    const agent = Roamie.tiles?.[0]?.creature?.agent;
    if (!agent) return setTimeout(boot, 100);
    window.sidekick = agent;
    // Inside the real app the sidekick is driven by its agent, not this script.
    if (qs.has('nodemo') || window.__TAURI__) return;
    if (qs.get('tool')) return soloTool(agent, qs.get('tool'), qs.get('variant'));
    run(agent);
  };
  const LONG = "Okay, here's the plan for today. First, record the Yaatuber demo using the five-beat card: the thing, why you care, three things you learned, what you'd do, and the handoff to Skool.\n\nSecond, cut two Shorts from it while you're warmed up. Third, post the Skool announcement with a real date, so 590 people are waiting on you.\n\nThat's it. Three things, one sitting. I'll ping you at 2pm if the recording hasn't started.";
  const stream = async (a, text, opts) => {
    const s = a.say('', { stream: true, ...opts });
    for (const w of text.split(/(?<= )/)) { s.append(w); await wait(0.03 + Math.random() * 0.05); }
    s.end();
    return s;
  };
  async function soloTool(a, name, variant) {
    await wait(0.6);
    for (;;) { await a.tool(name, { variant: variant || undefined, detail: 'demo' }).closed; await wait(0.8); }
  }
  async function tools(a, loop) {
    const v = (list) => list[loop % list.length];
    a.say("Let me look at your screen.");
    await wait(1.2);
    await a.tool('screenshot', { variant: v(['screen', 'region', 'window']), detail: v(['full screen', 'selection', 'Brave']) }).closed;
    await a.say('Fourteen tabs. Ken. Fourteen.', { mood: 'annoyed' }).closed;
    await a.tool('read', { variant: v(['file', 'many', 'search']), detail: v(['README.md', 'src/ (5 files)', '"record"']) }).closed;
    await a.think('The card says: hook, why, three things, verdict, handoff.', { dur: 1.8 }).closed;
    await a.tool('write', { variant: v(['edit', 'create', 'delete']), detail: v(['script.md', 'shorts.md', 'old-draft.md']) }).closed;
    await a.tool('run', { variant: v(['ok', 'progress', 'fail']), detail: v(['npm test', 'yaatuber export', 'npm run build']) }).closed;
    await a.tool('web', { variant: v(['search', 'fetch']), detail: v(['"youtube shorts length"', 'skool.com/kenkai']) }).closed;
    await (await stream(a, "Done. Script's written, tests pass, and Shorts can be up to three minutes now. You're out of excuses!", { mood: 'determined' })).closed;
  }
  async function run(a) {
    await wait(1);
    if (qs.get('scene') === 'tools') { for (let i = 0; ; i++) { await tools(a, i); await wait(1.5); } }
    for (let i = 0; ; i++) {
      await a.think('', { dur: 1.6 }).closed;
      await a.say('Hey Ken! Ready to knock out that video today?', { mood: 'happy' }).closed;
      await tools(a, i);
      await wait(0.6);
      await (await stream(a, LONG)).closed;
      await wait(0.8);
      await a.say("You haven't hit record in four hours. I'm not mad. I'm just disappointed.", { mood: 'annoyed' }).closed;
      await wait(2);
    }
  }
  boot();
})();
