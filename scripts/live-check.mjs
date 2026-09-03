import fs from 'node:fs/promises'
import path from 'node:path'
import { CdpSession, listCodexTargets } from '../src/cdp.mjs'

const target = (await listCodexTargets(9341)).find((item) => item.type === 'page' && item.url.startsWith('app://') && !item.url.includes('avatar-overlay'))
if (!target) throw new Error('未找到 Codex 主 renderer')
const cdp = new CdpSession(target, 9341)
const action = ['--menu', '--v2', '--trajectory', '--legacy', '--compare'].includes(process.argv[2]) ? process.argv[2] : null
const screenshotPath = action ? process.argv[3] : process.argv[2]
await cdp.open()
try {
  const before = await cdp.evaluate(`({ href: location.href, selectedSession: document.querySelector('[data-app-action-sidebar-thread-selected="true"]')?.getAttribute('data-app-action-sidebar-thread-id') ?? null, api: !!window.__CODEX_TRAJECTORY__, root: !!document.getElementById('codex-trajectory-root'), menuItemCount: document.querySelectorAll('.codex-trajectory-menu-item').length, drawerOpen: document.getElementById('codex-trajectory-drawer')?.getAttribute('aria-hidden') === 'false' })`)
  if (action) {
    await cdp.evaluate(`(() => { document.querySelector('.codex-trajectory-menu-trigger')?.click(); const items = document.querySelectorAll('.codex-trajectory-menu-item'); ${action === '--v2' ? 'items[0]?.click();' : action === '--trajectory' || action === '--legacy' ? 'items[1]?.click();' : action === '--compare' ? 'items[2]?.click();' : ''} return true; })()`)
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  const after = await cdp.evaluate(`(() => { const iframe = document.querySelector('#codex-trajectory-drawer iframe:not([hidden])'); const drawer = document.getElementById('codex-trajectory-drawer'); const item = document.querySelector('.codex-trajectory-menu-item'); const menu = document.querySelector('.codex-trajectory-menu'); const r = menu?.getBoundingClientRect(); return { href: location.href, root: !!document.getElementById('codex-trajectory-root'), menuItemCount: document.querySelectorAll('.codex-trajectory-menu-item').length, menuItemWeight: item ? getComputedStyle(item).fontWeight : null, menuRect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null, drawerOpen: drawer?.getAttribute('aria-hidden') === 'false', drawerShadow: drawer ? getComputedStyle(drawer).boxShadow : null, drawerVisibility: drawer ? getComputedStyle(drawer).visibility : null, drawerTitle: document.querySelector('.codex-trajectory-title')?.textContent ?? null, iframe: !!iframe, frameHash: iframe ? new URL(iframe.src).hash : null, status: document.querySelector('.codex-trajectory-status')?.textContent ?? null }; })()`)
  const targets = await (await fetch('http://127.0.0.1:9341/json/list')).json()
  const iframeTarget = targets.find((item) => item.type === 'iframe' && item.parentId === target.id && item.url.startsWith('blob:') && (!after.frameHash || item.url.endsWith(after.frameHash)))
  let iframeState = null
  const iframeErrors = []
  if (iframeTarget) {
    const frameCdp = new CdpSession(iframeTarget, 9341)
    frameCdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => iframeErrors.push(exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'exception'))
    frameCdp.on('Log.entryAdded', ({ entry }) => { if (entry?.level === 'error') iframeErrors.push(entry.text) })
    await frameCdp.open()
    try {
      await frameCdp.send('Log.enable')
      await new Promise((resolve) => setTimeout(resolve, 200))
      iframeState = await frameCdp.evaluate(`({ ready: document.readyState, v2: !!document.getElementById('atlas'), screenVisible: document.getElementById('screen') ? !document.getElementById('screen').hidden : null, liveMode: typeof liveMode === 'undefined' ? null : liveMode, drop: document.getElementById('drop')?.style.display ?? null, bodyLive: document.body.classList.contains('live'), svgChildren: document.querySelector('svg')?.children.length ?? 0 })`)
    } finally { frameCdp.close() }
  }
  if (screenshotPath) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000)
    await fs.writeFile(path.resolve(screenshotPath), Buffer.from(shot.data, 'base64'))
  }
  console.log(JSON.stringify({ target: { id: target.id, url: target.url }, action, before, after, iframeState, iframeErrors, screenshot: screenshotPath || null }, null, 2))
} finally { cdp.close() }
