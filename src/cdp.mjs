const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const ID_RE = /^[A-Za-z0-9._-]{1,200}$/

function websocketUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl)
  if (url.protocol !== 'ws:' || !LOOPBACK.has(url.hostname) || Number(url.port) !== port
    || url.username || url.password || url.search || url.hash
    || !url.pathname.startsWith('/devtools/page/')
    || !ID_RE.test(url.pathname.slice('/devtools/page/'.length))) {
    throw new Error('拒绝非 loopback Codex CDP WebSocket')
  }
  return url.href
}

export function isCodexTarget(target, port) {
  if (target?.type !== 'page' || typeof target.url !== 'string' || !target.url.startsWith('app://')
    || typeof target.id !== 'string' || !ID_RE.test(target.id) || !target.webSocketDebuggerUrl) return false
  try { websocketUrl(target, port); return true } catch { return false }
}

export async function listCodexTargets(port = 9341) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error' })
  if (!response.ok) throw new Error(`CDP /json/list HTTP ${response.status}`)
  const targets = await response.json()
  if (!Array.isArray(targets)) throw new Error('CDP target list 不是数组')
  return targets.filter((target) => isCodexTarget(target, port) && !target.url.includes('avatar-overlay'))
}

export async function listTrajectoryV2Targets(port = 9341, parentIds = new Set()) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error' })
  if (!response.ok) throw new Error(`CDP /json/list HTTP ${response.status}`)
  const targets = await response.json()
  if (!Array.isArray(targets)) throw new Error('CDP target list 不是数组')
  return targets.filter((target) => target?.type === 'iframe'
    && parentIds.has(target.parentId)
    && typeof target.url === 'string'
    && target.url.startsWith('blob:app://-/')
    && target.url.endsWith('#trajectory-v2')
    && typeof target.id === 'string' && ID_RE.test(target.id)
    && target.webSocketDebuggerUrl
    && (() => { try { websocketUrl(target, port); return true } catch { return false } })())
}

export class CdpSession {
  constructor(target, port) {
    this.target = target
    this.ws = new WebSocket(websocketUrl(target, port))
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP WebSocket 打开超时')), 5000)
      this.ws.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
      this.ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP WebSocket 打开失败')) }, { once: true })
    })
    this.ws.addEventListener('message', (event) => this.#message(event))
    this.ws.addEventListener('close', () => this.close())
    await this.send('Runtime.enable')
    await this.send('Page.enable')
    return this
  }

  #message(event) {
    let message
    try { message = JSON.parse(String(event.data)) } catch { this.close(); return }
    if (message.id) {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      clearTimeout(waiter.timeout)
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
      return
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {})
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  send(method, params = {}, timeoutMs = 10000) {
    if (this.closed) return Promise.reject(new Error('CDP session 已关闭'))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 命令超时: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      try { this.ws.send(JSON.stringify({ id, method, params })) } catch (error) {
        clearTimeout(timeout); this.pending.delete(id); reject(error)
      }
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('CDP session closed')) }
    this.pending.clear()
    try { this.ws.close() } catch {}
  }
}
