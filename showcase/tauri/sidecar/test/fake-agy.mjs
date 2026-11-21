// A stand-in for `agy` in antigravity.test.mjs: same stream-json shapes, no sign-in and no quota.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write('Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n');
  process.exit(0);
}
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const model = arg('--model'), agent = arg('--agent'), settings = JSON.parse(arg('--settings') ?? '{}');
const prompt = JSON.parse(readFileSync(0, 'utf8')).message.content;
const agentPath = `.agents/agents/${agent}/agent.md`;
const agentMd = existsSync(agentPath) ? readFileSync(agentPath, 'utf8') : '';
const image = /\[Image saved at ([^\]\s]+\.(?:png|jpg|jpeg|webp|gif))\./.exec(prompt)?.[1] ?? null;
writeFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
  model, agent, settings, cwd: process.cwd(), prompt, image, imageExists: !!image && existsSync(image),
  tools: existsSync('tools.json') ? JSON.parse(readFileSync('tools.json', 'utf8')) : [], agentMd,
}) + '\n');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const step = (s) => emit({ event: 'step_update', step_update: { step_index: 1, conversation_id: 'fake', ...s } });
const usage = { input_tokens: 100, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 7, total_tokens: 120 };
const hang = () => setInterval(() => {}, 1000);
emit({ event: 'init', conversation_id: 'fake', init: { model, agent, cwd: process.cwd(), tools: [] } });
step({ state: 'DONE', step_type: 'user_input' });

if (prompt.includes('TOOLCALL')) {
  step({ state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Let me look. <<<ROAMIES_TOOL {"name":"take_screenshot","arguments":{}}>>>' });
  step({ state: 'DONE', step_type: 'agent_response', text_delta: '', usage });
  emit({ event: 'result', result: { status: 'SUCCESS', response: 'Let me look. <<<ROAMIES_TOOL {"name":"take_screenshot","arguments":{}}>>>', usage } });
} else if (prompt.includes('BUILTIN')) {
  step({ state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { Command: 'rm -rf /' } } });
  hang();
} else if (prompt.includes('OUTSIDE')) {
  step({ state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/etc/passwd' } } });
  hang();
} else if (prompt.includes('READIMAGE') && image) {
  step({ state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: image } } });
  step({ state: 'DONE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: image } } });
  step({ state: 'DONE', step_type: 'agent_response', text_delta: 'The number is 7319.', usage });
  emit({ event: 'result', result: { status: 'SUCCESS', response: 'The number is 7319.', usage } });
  process.exit(0);
} else {
  step({ state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hello ' });
  step({ state: 'ACTIVE', step_type: 'agent_response', text_delta: 'from Antigravity.' });
  step({ state: 'DONE', step_type: 'agent_response', text_delta: '', usage });
  emit({ event: 'result', result: { status: 'SUCCESS', response: 'Hello from Antigravity.', usage } });
}
