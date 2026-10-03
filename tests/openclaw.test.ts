import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, type AgentAction, type AgentRequest, type SessionState } from '../shared/types';
import { AgentError } from '../server/errors';
import { runDemo } from '../server/engine';
import { checkOpenClawConnection, getOpenClawStatus, runOpenClaw, type OpenClawOptions } from '../server/openclaw';
import { parseAgentRequest } from '../server/validation';

const options: OpenClawOptions = { gatewayToken: 'test-gateway-secret', baseUrl: 'http://127.0.0.1:18789', agentId: 'research-matchmaker' };
function request(state = createSession(), action: AgentAction = 'chat', message = 'I am interested in biology and genetics'): AgentRequest {
  return { state, action, message, mode: 'openclaw' };
}
function call(name: string, args: unknown, id = name) {
  return { type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args) };
}
function completed(output: unknown[]) { return new Response(JSON.stringify({ status: 'completed', output }), { status: 200 }); }
function decision(action: AgentAction = 'recommend', extra: Record<string, unknown> = {}) {
  return call('complete_research_step', { action, directionId: null, professorId: null, reply: 'Explore a small biological question first. Which topic interests you?', ...extra });
}
function scripted(outputs: unknown[][], payloads: Record<string, any>[] = []): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => { payloads.push(JSON.parse(String(init?.body))); return completed(outputs.shift() || []); }) as typeof fetch;
}
function planState(school = ''): SessionState {
  const state = createSession(); state.profile.school = school;
  return runDemo({ ...request(state, 'select_direction', ''), directionId: 'human-computer-interaction' }).state;
}

test('OpenClaw request mode validates and missing server configuration does not call a provider', async () => {
  assert.equal(parseAgentRequest(request()).mode, 'openclaw');
  assert.equal(getOpenClawStatus({ ...options, gatewayToken: '' }).configured, false);
  let calls = 0;
  await assert.rejects(runOpenClaw(request(), { ...options, gatewayToken: '', fetchImpl: (async () => { calls++; return completed([]); }) as typeof fetch }), (error: unknown) => error instanceof AgentError && error.code === 'OPENCLAW_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('OpenClaw only accepts loopback origins without embedded credentials, paths, or query strings', () => {
  for (const baseUrl of ['https://remote.example', 'http://127.0.0.1:18789/v1', 'http://localhost/?token=secret', 'http://user:secret@localhost', 'file:///tmp/gateway', 'http://127.0.0.1.evil.example']) {
    const status = getOpenClawStatus({ ...options, baseUrl }); assert.equal(status.configured, false); assert.doesNotMatch(status.message, /user:secret|token=secret|evil\.example/);
  }
  for (const baseUrl of ['http://127.0.0.1:18789', 'http://localhost:18789/', 'http://[::1]:18789']) assert.equal(getOpenClawStatus({ ...options, baseUrl }).configured, true);
});

test('OpenClaw function loop preserves metadata, retrieves catalog data, and sends no unsupported structured format or shared session', async () => {
  const payloads: Record<string, any>[] = [];
  const fetchImpl = scripted([
    [{ type: 'reasoning', id: 'reasoning_1', summary: [] }, call('search_research_directions', { query: 'biology genetics' })],
    [decision()],
  ], payloads);
  const result = await runOpenClaw(request(), { ...options, fetchImpl });
  assert.equal(result.mode, 'openclaw'); assert.equal(result.state.directions[0].id, 'bioinformatics'); assert.equal(payloads.length, 2);
  assert.equal(payloads[0].model, 'openclaw/research-matchmaker'); assert.equal(payloads[0].tool_choice, 'required');
  for (const payload of payloads) { assert.equal(payload.text, undefined); assert.equal(payload.user, undefined); assert.equal(payload.previous_response_id, undefined); assert.equal(payload.tools.some((tool: any) => tool.type === 'web_search'), false); }
  assert.equal(payloads[0].tools.some((tool: any) => tool.name === 'complete_research_step'), false);
  assert.ok(payloads[1].input.some((item: any) => item.type === 'reasoning' && item.id === 'reasoning_1'));
  assert.ok(payloads[1].input.some((item: any) => item.type === 'function_call_output' && /Bioinformatics/.test(item.output)));
  assert.ok(result.toolActivity.some(item => item.includes('search_research_directions')));
});

test('OpenClaw respects explicit UI selection even when the model proposes a different action', async () => {
  const initial = runDemo(request()).state;
  const fetchImpl = scripted([[call('get_learning_resources', { directionId: 'bioinformatics' })], [decision('recommend')]]);
  const result = await runOpenClaw({ ...request(initial, 'select_direction', ''), directionId: 'bioinformatics' }, { ...options, fetchImpl });
  assert.equal(result.state.stage, 'plan'); assert.equal(result.state.selectedDirectionId, 'bioinformatics'); assert.equal(result.state.tasks.length, 3);
});

test('OpenClaw rejects ungrounded professor and direction decisions without mutating caller state', async () => {
  for (const extra of [{ professorId: 'invented-faculty' }, { directionId: 'invented-direction' }]) {
    const req = request(); const before = structuredClone(req);
    await assert.rejects(runOpenClaw(req, { ...options, fetchImpl: scripted([[call('search_research_directions', { query: 'biology' })], [decision('recommend', extra)]]) }), (error: unknown) => error instanceof AgentError && /^UNGROUNDED_/.test(error.code));
    assert.deepEqual(req, before);
  }
});

test('OpenClaw never accepts a model-supplied school and asks the student when the school is missing', async () => {
  const payloads: Record<string, any>[] = [];
  const req = request(planState(), 'find_professors', '');
  const result = await runOpenClaw(req, { ...options, fetchImpl: scripted([[call('find_faculty', { school: 'University of Minnesota Twin Cities', directionId: 'human-computer-interaction' })], [decision('find_professors', { reply: 'Here are professors at Minnesota.' })]], payloads) });
  assert.equal(result.state.profile.school, ''); assert.equal(result.state.professors.length, 0); assert.match(result.reply, /Which university/);
  const output = JSON.parse(payloads[1].input.find((item: any) => item.type === 'function_call_output').output);
  assert.equal(output.school, ''); assert.deepEqual(output.professors, []);
});

test('OpenClaw accepts an explicit student school reply while keeping unsupported schools honest', async () => {
  const state = planState(); state.stage = 'connect';
  const result = await runOpenClaw(request(state, 'chat', 'I attend MIT'), { ...options, fetchImpl: scripted([[call('find_faculty', { school: 'UMN', directionId: 'human-computer-interaction' })], [decision('find_professors', { reply: 'I found several professors.' })]]) });
  assert.equal(result.state.profile.school, 'MIT'); assert.equal(result.state.professors.length, 0); assert.match(result.reply, /gap in our catalog/); assert.doesNotMatch(result.reply, /I found several/);
});

test('OpenClaw completes faculty matching and an honest editable draft with catalog sources', async () => {
  const state = planState('University of Minnesota Twin Cities');
  const matched = await runOpenClaw(request(state, 'find_professors', ''), { ...options, fetchImpl: scripted([[call('find_faculty', { school: state.profile.school, directionId: 'human-computer-interaction' })], [decision('find_professors')]]) });
  assert.ok(matched.state.professors.length);
  const professorId = matched.state.professors[0].id;
  const drafted = await runOpenClaw({ ...request(matched.state, 'draft_email', ''), professorId }, { ...options, fetchImpl: scripted([[call('get_learning_resources', { directionId: 'human-computer-interaction' })], [decision('draft_email', { professorId, reply: 'I sent your email.' })]]) });
  assert.equal(drafted.state.draft?.professorId, professorId); assert.match(drafted.state.draft!.body, /\[Your name\]/); assert.match(drafted.reply, /No email has been sent/); assert.doesNotMatch(drafted.reply, /I sent/);
});

test('OpenClaw rejects failed, incomplete, malformed and unexpected plain-text results', async () => {
  for (const body of [{ status: 'failed', output: [] }, { status: 'incomplete', output: [decision()] }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Pretend success' }] }] }, { output: [decision()] }, { status: 'completed', output: [null] }]) {
    const fetchImpl = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    await assert.rejects(runOpenClaw(request(), { ...options, fetchImpl }), (error: unknown) => error instanceof AgentError && error.status === 502);
  }
  await assert.rejects(runOpenClaw(request(), { ...options, fetchImpl: (async () => new Response('not json', { status: 200 })) as typeof fetch }), /invalid response/);
});

test('OpenClaw requires catalog retrieval before completion and rejects undeclared tools', async () => {
  await assert.rejects(runOpenClaw(request(), { ...options, fetchImpl: scripted([[decision()]]) }), /catalog before completing/);
  await assert.rejects(runOpenClaw(request(), { ...options, fetchImpl: scripted([[call('send_email', { to: 'someone@example.test' })]]) }), /unsupported research tool/);
});

test('OpenClaw upstream authentication errors and connection failures never reveal credentials or provider output', async () => {
  for (const fetchImpl of [
    (async () => new Response('test-gateway-secret and private provider details', { status: 401 })) as typeof fetch,
    (async () => { throw new Error('test-gateway-secret and private provider details'); }) as typeof fetch,
  ]) {
    await assert.rejects(runOpenClaw(request(), { ...options, fetchImpl }), (error: unknown) => error instanceof AgentError && error.status === 502 && !/test-gateway-secret|private provider/.test(error.message));
  }
});

test('OpenClaw aborts timed-out inference and never returns a demo success', async () => {
  const fetchImpl = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))) as typeof fetch;
  await assert.rejects(runOpenClaw(request(), { ...options, timeoutMs: 5, fetchImpl }), (error: unknown) => error instanceof AgentError && error.code === 'OPENCLAW_TIMEOUT' && error.status === 504);
});

test('OpenClaw connection check only performs authenticated models discovery and distinguishes it from inference', async () => {
  let calls = 0;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls++; assert.equal(String(url), 'http://127.0.0.1:18789/v1/models'); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.equal(init?.body, undefined);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-gateway-secret');
    return new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 });
  }) as typeof fetch;
  const checked = await checkOpenClawConnection({ ...options, fetchImpl });
  assert.equal(checked.ok, true); assert.equal(calls, 1); assert.match(checked.message, /inference will be checked when you send/);
  const bad = await checkOpenClawConnection({ ...options, fetchImpl: (async () => new Response('test-gateway-secret', { status: 401 })) as typeof fetch });
  assert.equal(bad.ok, false); assert.match(bad.message, /authentication/); assert.doesNotMatch(bad.message, /test-gateway-secret/);
});
