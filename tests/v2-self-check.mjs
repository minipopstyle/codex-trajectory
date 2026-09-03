import assert from 'node:assert/strict'
import { buildTrajectoryV2, commandName, escapeReportJson } from '../src/v2-data.mjs'

const id = '11111111-1111-4111-8111-111111111111'
const at = second => new Date(Date.UTC(2026, 7, 24, 10, 0, second)).toISOString()
const events = [
  { timestamp: at(0), type: 'session_meta', payload: { id, model_provider: 'openai' } },
  { timestamp: at(0), type: 'turn_context', payload: { model: 'gpt-5.6', effort: 'high' } },
  { timestamp: at(1), type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'UserMessage' } } },
  { timestamp: at(2), type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { input_tokens: 400, cached_input_tokens: 100, cache_write_input_tokens: 50, output_tokens: 80, reasoning_output_tokens: 30 }, total_token_usage: { total_tokens: 480, input_tokens: 400, output_tokens: 80 } } } },
  { timestamp: at(3), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'bad', input: '{"command":"rg missing"}' } },
  { timestamp: at(4), type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'CommandExecution', id: 'bad', started_at_ms: Date.parse(at(3)), completed_at_ms: Date.parse(at(4)), exit_code: 1, status: 'failed', stdout: '</script><b>bad</b>', parsed_cmd: [{ type: 'search', cmd: 'rg missing' }] } } },
  { timestamp: at(5), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'good', input: '{"command":"rg found"}' } },
  { timestamp: at(6), type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'CommandExecution', id: 'good', started_at_ms: Date.parse(at(5)), completed_at_ms: Date.parse(at(6)), exit_code: 0, status: 'completed', stdout: 'found', parsed_cmd: [{ type: 'search', cmd: 'rg found' }] } } },
  { timestamp: at(7), type: 'event_msg', payload: { type: 'context_compacted' } },
  { timestamp: at(8), type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { input_tokens: 620, cached_input_tokens: 120, cache_write_input_tokens: 50, output_tokens: 120, reasoning_output_tokens: 40 }, total_token_usage: { total_tokens: 740, input_tokens: 620, output_tokens: 120 } } } },
  { timestamp: at(9), type: 'event_msg', payload: { type: 'task_complete' } },
]

const snapshot = buildTrajectoryV2(events, { id }, [{ id: 'child', parentId: id, kind: 'explicit', startedAt: at(2), durationMs: 1000, tokens: 5, toolCalls: 1, failures: 0 }])
assert.equal(snapshot.version, 2)
assert.equal(snapshot.metrics.turns, 1)
assert.equal(snapshot.metrics.modelCalls, 2)
assert.equal(snapshot.modelCalls[0].uncachedInput, 250)
assert.equal(snapshot.modelCalls[0].compacted, true)
assert.equal(snapshot.tools.length, 2)
assert.equal(snapshot.tools[0].status, 'failed')
assert.equal(snapshot.tools[0].name, 'exec_command')
assert.equal(snapshot.tools[0].label, 'rg')
assert.equal(snapshot.tools[0].category, 'Search')
assert.equal(commandName('/bin/zsh-lcnpm run check'), 'npm')
assert.equal(snapshot.tools[0].recovery, 'strategy_changed')
assert.equal(snapshot.tools[1].recovery, 'recovered')
assert.equal(snapshot.tools[0].result, '</script><b>bad</b>')
assert.equal(snapshot.agents.length, 1)
assert.match(snapshot.findings[0].detail, /失败最多：rg（1 次）/)
assert.match(snapshot.findings[1].detail, /最长调用为 rg/)
assert.match(snapshot.findings[2].detail, /最大输入 Token 620/)
const safe = escapeReportJson({ raw: '</script><b>bad</b>' })
assert.doesNotMatch(safe, /<\/script/i)
assert.match(safe, /\\u003c\/script/i)
console.log('v2 self-check passed')
