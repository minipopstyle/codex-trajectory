import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TrajectoryParser, buildMaze, findSessionFile, findSessionDescendants, mergeSubagentMetrics } from '../src/adapter.mjs'
import { createSessionAdapter } from '../src/session-data.mjs'
import { isCodexTarget } from '../src/cdp.mjs'
import { sessionIdFromHref } from '../src/host.mjs'
import { buildRendererSource } from '../src/renderer.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const [name, target] of [['重启.command', 'start.sh'], ['停止.command', 'stop.sh']]) {
  const command = await fs.readFile(path.join(root, 'scripts', name), 'utf8')
  assert.match(command, new RegExp(`exec.*${target.replace('.', '\\.')}`))
}
const fixture = await fs.readFile(path.join(root, 'tests/fixtures/sample-rollout.jsonl'), 'utf8')
const id = '11111111-1111-4111-8111-111111111111'

const parser = new TrajectoryParser(id)
const cut = Math.floor(fixture.length / 2)
parser.ingest(fixture.slice(0, cut))
parser.ingest(fixture.slice(cut), { final: true })
parser.ingest(fixture)
const snapshot = parser.snapshot()
assert.equal(snapshot.status, 'complete')
assert.equal(snapshot.data.lanes.length, 1)
assert.equal(snapshot.data.lanes[0].stats.tools, 1)
assert.equal(snapshot.data.lanes[0].stats.rz, 1)
assert.equal(snapshot.data.lanes[0].stats.ttftMs, 30)
assert.equal(snapshot.data.lanes[0].rows[0].tools[0].dur, 0.1)
assert.equal(snapshot.data.lanes[0].rows[0].tools[0].resFull, 'hello')
assert.deepEqual(snapshot.data.lanes[0].rows[0].tools[0].why, { k: 'exitOk' })
assert.equal(snapshot.data.lanes[0].rows[0].label, 'Done')
assert.equal(snapshot.data.lanes[0].rows[0].rzTok, 7)
assert.equal(snapshot.data.lanes[0].rows[0].outTok, 9)
assert.equal(snapshot.data.lanes[0].stats.totalTokens, 42)

// Modern Codex fields are deliberately checked independently from the old
// trajectory fixture: cumulative snapshots must never be summed.
const modern = [
  { timestamp: '2026-08-21T00:00:00Z', type: 'session_meta', payload: { id, source: 'user', model_provider: 'openai', cli_version: '1.2.3', dynamic_tools: ['exec'] } },
  { timestamp: '2026-08-21T00:00:00.001Z', type: 'turn_context', payload: { model: 'gpt-5.6', effort: 'high', comp_hash: 'abc' } },
  { timestamp: '2026-08-21T00:00:01Z', type: 'event_msg', payload: { type: 'user_message' } },
  { timestamp: '2026-08-21T00:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { input_tokens: 700, cached_input_tokens: 100, cache_write_input_tokens: 50, output_tokens: 90, reasoning_output_tokens: 30 }, total_token_usage: { total_tokens: 790, input_tokens: 700, cached_input_tokens: 100, cache_write_input_tokens: 50, output_tokens: 90, reasoning_output_tokens: 30 } } } },
  { timestamp: '2026-08-21T00:00:03Z', type: 'event_msg', payload: { type: 'context_compacted' } },
  { timestamp: '2026-08-21T00:00:04Z', type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { input_tokens: 950, cached_input_tokens: 200, cache_write_input_tokens: 50, output_tokens: 140, reasoning_output_tokens: 60 }, total_token_usage: { total_tokens: 1240, input_tokens: 950, cached_input_tokens: 200, cache_write_input_tokens: 50, output_tokens: 140, reasoning_output_tokens: 60 } } } },
  { timestamp: '2026-08-21T00:00:05Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'outer' } },
  { timestamp: '2026-08-21T00:00:06Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'outer', output: 'ok' } },
  { timestamp: '2026-08-21T00:00:05Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', id: 'inner', started_at_ms: Date.parse('2026-08-21T00:00:05Z'), completed_at_ms: Date.parse('2026-08-21T00:00:06Z'), exit_code: 0, status: 'completed', parsed_cmd: [{ type: 'read', cmd: 'cat a' }, { type: 'search', cmd: 'rg b' }] } } },
  { timestamp: '2026-08-21T00:00:07Z', type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'mcp', duration: 50, invocation: { server: 'x', tool: 'y' }, isError: true } },
  { timestamp: '2026-08-21T00:00:07.5Z', type: 'event_msg', payload: { type: 'sub_agent_activity', agent_thread_id: '22222222-2222-4222-8222-222222222222' } },
  { timestamp: '2026-08-21T00:00:08Z', type: 'event_msg', payload: { type: 'task_complete', time_to_first_token_ms: 88 } },
]
const metric = createSessionAdapter().metrics(modern, 2, id)
assert.equal(metric.identity.model, 'gpt-5.6')
assert.equal(metric.tokens.total, 1240)
assert.equal(metric.tokens.uncachedInput, 700)
assert.equal(metric.tokens.visibleOutput, 80)
assert.equal(metric.context.peakRatio, .95)
assert.equal(metric.context.compactions, 1)
assert.equal(metric.tools.total, 2) // one exec call plus one MCP call; parsed operations are types, not calls
assert.equal(metric.tools.failed, 1)
assert.equal(metric.tools.byCategory.read.total, 1)
assert.equal(metric.tools.byCategory.search.total, 1)
assert.equal(metric.tools.byName.exec_command.category, 'read / search')
assert.equal(metric.tools.byName.exec_command.byType.read.total, 1)
assert.equal(metric.tools.byName.exec_command.byType.search.total, 1)
assert.equal(metric.coverage.malformedLines, 2)
assert.equal(metric.subagents.expected, 1)
const itemMaze = buildMaze([
  { timestamp: '2026-08-21T00:00:00Z', type: 'session_meta', payload: { id } },
  { timestamp: '2026-08-21T00:00:01Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 't', item: { type: 'UserMessage' } } },
  { timestamp: '2026-08-21T00:00:01.500Z', type: 'response_item', payload: { id: 'outer-exec', type: 'custom_tool_call', name: 'exec', input: "await tools.exec_command({ cmd: 'pwd' })" } },
  { timestamp: '2026-08-21T00:00:02Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 't', started_at_ms: Date.parse('2026-08-21T00:00:02Z'), completed_at_ms: Date.parse('2026-08-21T00:00:03Z'), item: { type: 'CommandExecution', id: 'modern-command', command: ['pwd'], stdout: '/tmp', exit_code: 0, status: 'completed', parsed_cmd: [{ type: 'unknown', cmd: 'pwd' }] } } },
]).data.lanes[0]
assert.equal(itemMaze.rows.length, 1)
assert.equal(itemMaze.rows[0].tools[0].name, 'exec_command')
assert.equal(itemMaze.rows[0].tools[0].type, 'command')

const long = new TrajectoryParser(id)
long.ingest(JSON.stringify({ timestamp: '2026-08-20T10:00:01Z', type: 'event_msg', payload: { type: 'user_message', client_id: 'long' } }) + '\n')
long.ingest(JSON.stringify({ timestamp: '2026-08-20T10:00:02Z', type: 'response_item', payload: { id: 'long-tool', type: 'custom_tool_call', name: 'exec', call_id: 'long-call', input: 'x' } }) + '\n')
long.ingest(JSON.stringify({ timestamp: '2026-08-20T10:00:03Z', type: 'response_item', payload: { id: 'long-out', type: 'custom_tool_call_output', call_id: 'long-call', output: 'x'.repeat(6000) } }) + '\n')
assert.equal(long.snapshot().data.lanes[0].rows[0].tools[0].resFull.length, 5000)

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-trajectory-'))
const main = path.join(temp, `rollout-${id}.jsonl`)
const child = path.join(temp, `rollout-22222222-2222-4222-8222-222222222222.jsonl`)
await fs.writeFile(main, fixture)
await fs.writeFile(child, fixture.replace(id, '22222222-2222-4222-8222-222222222222').replace('"source":"user"', '"source":{"subagent":{"other":"guardian"}}'))
assert.equal(await findSessionFile(temp, id), main)
assert.equal(await findSessionFile(temp, '22222222-2222-4222-8222-222222222222'), null)
await fs.writeFile(child, fixture.replace(id, '22222222-2222-4222-8222-222222222222').replace('"source":"user"', '"source":{"subagent":{"thread_spawn":true}},"parent_thread_id":"' + id + '"'))
const descendants = await findSessionDescendants(temp, id)
assert.equal(descendants.length, 1)
assert.equal(descendants[0].id, '22222222-2222-4222-8222-222222222222')
const merged = mergeSubagentMetrics(metric, [{ kind: 'thread_spawn', metrics: metric }], 2)
assert.equal(merged.subagents.explicit, 1)
assert.equal(merged.coverage.subagentRatio, .5)
assert.equal(sessionIdFromHref(`app://codex/thread/${id}?x=1`), id)
assert.equal(sessionIdFromHref('app://codex/thread/01a01924-209c-7953-a083-b03ba7c75710'), '01a01924-209c-7953-a083-b03ba7c75710')
assert.equal(sessionIdFromHref('app://codex/settings'), null)

const good = { type: 'page', url: 'app://codex/thread/' + id, id: 'page-1', webSocketDebuggerUrl: 'ws://127.0.0.1:9341/devtools/page/page-1' }
assert.equal(isCodexTarget(good, 9341), true)
assert.equal(isCodexTarget({ ...good, url: 'https://evil.test' }, 9341), false)
assert.equal(isCodexTarget({ ...good, webSocketDebuggerUrl: 'ws://evil.test:9341/devtools/page/page-1' }, 9341), false)
const rendererSource = buildRendererSource('<main></main>')
const hostSource = await fs.readFile(path.join(root, 'src/host.mjs'), 'utf8')
assert.match(rendererSource, /stroke="currentColor"/)
assert.match(rendererSource, /width:28px;height:28px/)
assert.match(rendererSource, /box-shadow:none;visibility:hidden/)
assert.match(rendererSource, /width:calc\(100vw - 300px\)/)
assert.match(rendererSource, /实时分析 V2/)
assert.match(rendererSource, /trajectory-v2:snapshot/)
assert.match(rendererSource, /#trajectory-v2/)
assert.match(hostSource, /listTrajectoryV2Targets/)
assert.doesNotMatch(rendererSource, /Trace 对比|当前任务轨迹|trajectory-maze|trace-compare/)
assert.doesNotMatch(hostSource, /maze-upload\.html|attachMaze|enrichUploadedMaze/)
console.log('self-check passed')
