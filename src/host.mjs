import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRendererSource } from './renderer.mjs';
import { CdpSession, listCodexTargets, listMazeTargets } from './cdp.mjs';
import { TrajectoryParser, findSessionFile, findSessionDescendants, readSessionMetrics, mergeSubagentMetrics, readDelta, isUuid, buildMaze } from './adapter.mjs';
import { createSessionAdapter } from './session-data.mjs';
import { buildTrajectoryV2 } from './v2-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CODEX_TRAJECTORY_CDP_PORT || 9341);
const sessionsRoot = process.env.CODEX_SESSIONS_ROOT || path.join(os.homedir(), '.codex', 'sessions');
const mazeHtml = await fs.readFile(path.join(ROOT, 'vendor/dsh-trace-compare/maze-upload.html'), 'utf8');
const v2Html = await fs.readFile(path.join(ROOT, 'ui/trajectory-v2.html'), 'utf8');
const sharedAdapterSource = `window.__CODEX_SESSION_ADAPTER__ = (${createSessionAdapter.toString()})();`;
const mazeRuntimeSource = [...mazeHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)?.[1]?.replace('/*__CODEX_SESSION_ADAPTER__*/', sharedAdapterSource);
if (!mazeRuntimeSource) throw new Error('Maze runtime script not found');
const rendererSource = buildRendererSource(mazeHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ''), v2Html);
const earlySource = `(() => { const source = ${JSON.stringify(rendererSource)}; const apply = () => { if (!document.body) return false; try { (0,eval)(source); return true; } catch (_) { return false; } }; if (!apply()) { const o = new MutationObserver(() => { if (apply()) o.disconnect(); }); o.observe(document.documentElement, { childList: true, subtree: true }); setTimeout(() => o.disconnect(), 30000); } })();`;
const routeRe = /\/thread\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\/?#]|$)/i;

const controllers = new Map();
const mazeControllers = new Map();
const v2Controllers = new Map();
let stopped = false;
let lastNoCdp = 0;

function sessionIdFromHref(href) {
  const id = routeRe.exec(String(href || ''))?.[1]?.toLowerCase() || null;
  return id && isUuid(id) ? id : null;
}

function snapshotFor(id, parser, status = 'live', diagnostics) {
  const data = parser ? buildMaze(parser.events, parser.sessionMeta).data : null;
  return { sessionId: id, status, updatedAt: Date.now(), data, ...(diagnostics ? { diagnostics } : {}) };
}

function v2Agents(controller) {
  return (controller.childMetrics || []).map(child => ({
    id: child.id,
    parentId: controller.sessionId,
    kind: child.kind === 'thread_spawn' ? '显式子 Agent' : '系统子 Agent',
    startedAt: child.metrics?.identity?.startedAt || null,
    durationMs: child.metrics?.timing?.activeMs || 0,
    tokens: child.metrics?.tokens?.total || 0,
    toolCalls: child.metrics?.tools?.total || 0,
    failures: child.metrics?.tools?.failed || 0,
  }));
}

function v2SnapshotFor(controller, id, status = 'live', diagnostics) {
  const data = controller.parser ? buildTrajectoryV2(controller.parser.events, controller.parser.sessionMeta, v2Agents(controller)) : null;
  if (data) { data.session.id ||= id; data.session.status = status; }
  return { sessionId: id, status, updatedAt: Date.now(), data, ...(diagnostics ? { diagnostics } : {}) };
}

async function enrichSubagents(controller, data) {
  const lane = data?.lanes?.[0]; if (!lane?.metrics) return data
  const childSignal = controller.parser.events.filter(e => e.payload?.type === 'sub_agent_activity').map(e => e.payload.agent_thread_id).filter(Boolean).sort().join(',')
  if (controller.childSignal !== childSignal || !controller.children) {
    controller.childSignal = childSignal
    controller.children = await findSessionDescendants(sessionsRoot, controller.sessionId)
    controller.childMetrics = await Promise.all(controller.children.map(async child => ({
      kind: child.source?.subagent?.thread_spawn ? 'thread_spawn' : 'system', metrics: await readSessionMetrics(child.file, child.id), id: child.id,
    }))).catch(() => [])
  }
  lane.metrics = mergeSubagentMetrics(lane.metrics, controller.childMetrics ?? [], controller.children?.length ?? 0)
  return data
}

async function evaluate(controller, expression) {
  try { return await controller.cdp.evaluate(expression); } catch { return null; }
}

async function send(controller, snapshot) {
  const payload = JSON.stringify(snapshot);
  await evaluate(controller, `window.__CODEX_TRAJECTORY__?.setSnapshot(${payload}); true`);
}

async function sendV2(controller, snapshot) {
  const payload = JSON.stringify(snapshot);
  await evaluate(controller, `window.__CODEX_TRAJECTORY__?.setV2Snapshot(${payload}); true`);
}

async function route(controller) {
  const value = await evaluate(controller, `(() => { const match = /\\/thread\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\\/?#]|$)/i.exec(location.href); if (match) return match[1]; return document.querySelector('[data-app-action-sidebar-thread-selected="true"]')?.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^local:/, '') || null; })()`);
  return isUuid(value) ? value.toLowerCase() : null;
}

async function bind(controller, id) {
  controller.sessionId = id;
  controller.parser = null;
  controller.fileState = { offset: 0, inode: null, buffer: '', parser: null };
  controller.lastSignature = '';
  controller.childSignal = null;
  controller.children = null;
  controller.nextFileSearch = 0;
  if (!id) {
    await send(controller, { sessionId: '', status: 'loading', updatedAt: Date.now(), data: null });
    await sendV2(controller, { sessionId: '', status: 'loading', updatedAt: Date.now(), data: null });
    return;
  }
  const file = await findSessionFile(sessionsRoot, id);
  if (!file) {
    controller.nextFileSearch = Date.now() + 500;
    await send(controller, { sessionId: id, status: 'error', updatedAt: Date.now(), data: null, diagnostics: '未找到当前任务的主 rollout 文件' });
    await sendV2(controller, { sessionId: id, status: 'error', updatedAt: Date.now(), data: null, diagnostics: '未找到当前任务的主 rollout 文件' });
    return;
  }
  controller.file = file;
  controller.parser = new TrajectoryParser(id);
  controller.fileState.parser = controller.parser;
  await send(controller, snapshotFor(id, controller.parser, 'loading'));
  await sendV2(controller, v2SnapshotFor(controller, id, 'loading'));
}

async function tick(controller) {
  const id = await route(controller);
  if (id !== controller.sessionId) await bind(controller, id);
  if (!id || !controller.parser) return;
  if (!controller.file) {
    if (Date.now() < (controller.nextFileSearch || 0)) return;
    await bind(controller, id);
    if (!controller.file) return;
  }
  try {
    await readDelta(controller.file, controller.fileState);
    const result = buildMaze(controller.parser.events, controller.parser.sessionMeta);
    await enrichSubagents(controller, result.data);
    const status = result.status === 'complete' ? 'complete' : 'live';
    const diagnostics = controller.parser.malformed ? `忽略损坏 JSONL 行：${controller.parser.malformed}` : undefined;
    const signature = JSON.stringify({ status, data: result.data, diagnostics });
    if (signature !== controller.lastSignature) {
      controller.lastSignature = signature;
      await send(controller, { sessionId: id, status, updatedAt: Date.now(), data: result.data, ...(diagnostics ? { diagnostics } : {}) });
      await sendV2(controller, v2SnapshotFor(controller, id, status, diagnostics));
    }
  } catch (error) {
    await send(controller, { sessionId: id, status: 'error', updatedAt: Date.now(), data: null, diagnostics: error.message });
    await sendV2(controller, { sessionId: id, status: 'error', updatedAt: Date.now(), data: null, diagnostics: error.message });
  }
}

async function attach(target) {
  if (controllers.has(target.id)) return;
  const cdp = new CdpSession(target, PORT);
  try {
    await cdp.open();
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: earlySource });
    await cdp.evaluate(rendererSource);
    const controller = { id: target.id, cdp, sessionId: null, file: null, parser: null, fileState: null, lastSignature: '' };
    controllers.set(target.id, controller);
    await tick(controller);
  } catch (error) {
    cdp.close();
    if (Date.now() - lastNoCdp > 5000) { console.error(`[trajectory] attach skipped: ${error.message}`); lastNoCdp = Date.now(); }
  }
}

async function attachMaze(target) {
  if (mazeControllers.has(target.id)) return;
  const cdp = new CdpSession(target, PORT);
  try {
    await cdp.open();
    if (!await cdp.evaluate(`window.__CODEX_SESSION_ADAPTER__ ? true : (0,eval)(${JSON.stringify(sharedAdapterSource)}), true`)) {}
    if (!await cdp.evaluate(`typeof renderData === 'function'`)) await cdp.evaluate(mazeRuntimeSource);
    mazeControllers.set(target.id, { cdp, uploadSignature: '' });
    for (const controller of controllers.values()) await evaluate(controller, 'window.__CODEX_TRAJECTORY__?.resend(); true');
  } catch (error) {
    cdp.close();
    console.error(`[trajectory] maze attach skipped: ${error.message}`);
  }
}

async function attachV2(target) {
  if (v2Controllers.has(target.id)) return;
  const cdp = new CdpSession(target, PORT);
  try {
    await cdp.open();
    await cdp.evaluate(await fs.readFile(path.join(ROOT, 'src/v2-runtime.mjs'), 'utf8'));
    v2Controllers.set(target.id, { cdp });
    for (const controller of controllers.values()) await evaluate(controller, 'window.__CODEX_TRAJECTORY__?.resend(); true');
  } catch (error) {
    cdp.close();
    console.error(`[trajectory] v2 attach skipped: ${error.message}`);
  }
}

async function enrichUploadedMaze(controller) {
  const raw = await evaluate({ cdp: controller.cdp }, 'window.__CODEX_TRAJECTORY_METRICS__?.raw?.() || null')
  if (!raw || typeof raw !== 'object') return
  const signature = Object.keys(raw).sort().join(',')
  if (!signature || signature === controller.uploadSignature) return
  controller.uploadSignature = signature
  const enriched = {}
  for (const [id, main] of Object.entries(raw)) {
    const children = await findSessionDescendants(sessionsRoot, id)
    const childMetrics = await Promise.all(children.map(async child => ({ kind: child.source?.subagent?.thread_spawn ? 'thread_spawn' : 'system', metrics: await readSessionMetrics(child.file, child.id) }))).catch(() => [])
    enriched[id] = mergeSubagentMetrics(main, childMetrics, children.length)
  }
  await evaluate({ cdp: controller.cdp }, `window.__CODEX_TRAJECTORY_METRICS__?.set(${JSON.stringify(enriched)}); true`)
}

async function poll() {
  if (stopped) return;
  try {
    const targets = await listCodexTargets(PORT);
    const live = new Set();
    for (const target of targets) { live.add(target.id); await attach(target); }
    for (const [id, controller] of controllers) {
      if (!live.has(id)) { controller.cdp.close(); controllers.delete(id); continue; }
      await tick(controller);
    }
    const mazeTargets = await listMazeTargets(PORT, new Set(controllers.keys()));
    const liveMaze = new Set();
    const liveV2 = new Set();
    for (const target of mazeTargets) {
      if (target.url.endsWith('#trajectory-v2')) { liveV2.add(target.id); await attachV2(target); }
      else { liveMaze.add(target.id); await attachMaze(target); }
    }
    for (const [id, controller] of mazeControllers) {
      if (!liveMaze.has(id)) { controller.cdp.close(); mazeControllers.delete(id); }
      else await enrichUploadedMaze(controller);
    }
    for (const [id, controller] of v2Controllers) {
      if (!liveV2.has(id)) { controller.cdp.close(); v2Controllers.delete(id); }
    }
  } catch (error) {
    if (Date.now() - lastNoCdp > 5000) { console.error(`[trajectory] waiting for Codex CDP on 127.0.0.1:${PORT} (${error.message})`); lastNoCdp = Date.now(); }
  }
  if (!stopped) setTimeout(poll, 250);
}

async function stop() {
  if (stopped) return;
  stopped = true;
  for (const controller of controllers.values()) {
    await evaluate(controller, 'window.__CODEX_TRAJECTORY__?.cleanup(); true');
    controller.cdp.close();
  }
  controllers.clear();
  for (const controller of mazeControllers.values()) controller.cdp.close();
  mazeControllers.clear();
  for (const controller of v2Controllers.values()) controller.cdp.close();
  v2Controllers.clear();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => void stop().finally(() => process.exit(0)));
  process.on('SIGTERM', () => void stop().finally(() => process.exit(0)));
  console.log(`[trajectory] watching ${sessionsRoot}; CDP 127.0.0.1:${PORT}`);
  poll();
}

export { sessionIdFromHref };
