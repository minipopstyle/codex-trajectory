function install(v2Html) {
  const KEY = '__CODEX_TRAJECTORY__';
  const STATE_KEY = '__CODEX_TRAJECTORY_STATE__';
  const ROOT_ID = 'codex-trajectory-root';
  const routeRe = /\/thread\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  window[KEY]?.cleanup?.();

  let root, trigger, drawer, status, iframe, frameUrl, frameReady = false, latest = null, open = false, routeTimer, themeTimer;
  const listeners = [];
  const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
  const taskId = () => routeRe.exec(location.href)?.[1]?.toLowerCase() || (() => { const id = document.querySelector('[data-app-action-sidebar-thread-selected="true"]')?.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^local:/, '') || ''; return uuidRe.test(id) ? id.toLowerCase() : null; })();
  const theme = () => /dark/i.test(document.documentElement.dataset.theme || document.body?.dataset.theme || '') || document.documentElement.classList.contains('dark') || document.body?.classList.contains('dark') || matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const locale = () => /^zh\b/i.test(document.documentElement.lang || navigator.language || '') ? 'zh' : 'en';
  const send = () => {
    if (!iframe) return;
    if (latest) iframe.contentWindow?.postMessage({ kind: 'trajectory-v2:snapshot', data: latest.data }, '*');
    iframe.contentWindow?.postMessage({ kind: 'trajectory-v2:theme', mode: theme() }, '*');
    iframe.contentWindow?.postMessage({ kind: 'trajectory-v2:locale', lang: locale() }, '*');
  };
  const setStatus = () => {
    const value = latest?.status || 'loading';
    const text = latest?.diagnostics ? `${value} · ${latest.diagnostics}` : value;
    if (status?.textContent !== text) status.textContent = text;
    if (status?.dataset.status !== value) status.dataset.status = value;
  };
  const close = () => { open = false; drawer?.setAttribute('aria-hidden', 'true'); trigger?.setAttribute('aria-expanded', 'false'); trigger?.focus(); };
  const openDrawer = () => {
    if (!taskId()) return;
    open = true;
    drawer?.setAttribute('aria-hidden', 'false');
    trigger?.setAttribute('aria-expanded', 'true');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'Codex Trajectory V2';
      iframe.sandbox = 'allow-scripts allow-modals allow-downloads';
      frameUrl = URL.createObjectURL(new Blob([v2Html], { type: 'text/html' }));
      iframe.src = `${frameUrl}#trajectory-v2`;
      iframe.addEventListener('load', () => { frameReady = true; send(); }, { once: true });
      drawer?.querySelector('.codex-trajectory-frame')?.append(iframe);
      setTimeout(send, 250);
    }
    setStatus(); send();
  };
  const reconcile = () => {
    const valid = Boolean(taskId());
    if (trigger) trigger.disabled = !valid;
    if (root) root.hidden = !valid;
    if (!valid && open) close();
    setStatus();
  };
  const build = () => {
    if (root || !document.body) return;
    root = document.createElement('div'); root.id = ROOT_ID;
    root.innerHTML = '<button type="button" class="codex-trajectory-trigger" aria-label="Open live trajectory analysis" title="实时分析 V2" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M4 24C4 24 6 4 14 4C22 4 23 19 24 24C25 29 28 44 35 44C42 44 44 24 44 24" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 24H17M31 24H37" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><section id="codex-trajectory-drawer" class="codex-trajectory-drawer" aria-hidden="true" role="dialog" aria-label="实时分析 V2"><header><strong>Trajectory V2 · 实时分析</strong><span class="codex-trajectory-status">loading</span><button type="button" class="codex-trajectory-close" aria-label="Close Trajectory">×</button></header><div class="codex-trajectory-frame"></div></section>';
    const style = document.createElement('style');
    style.textContent = '#codex-trajectory-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:13px -apple-system,BlinkMacSystemFont,sans-serif}#codex-trajectory-root[hidden]{display:none}.codex-trajectory-trigger{pointer-events:auto;position:fixed;top:52px;left:252px;display:grid;place-items:center;width:28px;height:28px;padding:4px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:8px;background:Canvas;color:CanvasText;cursor:pointer}.codex-trajectory-trigger:hover{background:color-mix(in srgb,CanvasText 6%,transparent)}.codex-trajectory-trigger:disabled{opacity:.45;cursor:default}.codex-trajectory-trigger svg{width:18px;height:18px}.codex-trajectory-drawer{pointer-events:auto;position:fixed;right:0;top:0;height:100%;width:calc(100vw - 300px);min-width:560px;background:Canvas;color:CanvasText;box-shadow:none;visibility:hidden;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .18s ease,visibility 0s linear .18s}.codex-trajectory-drawer[aria-hidden="false"]{transform:translateX(0);visibility:visible;box-shadow:-8px 0 28px #0004;transition-delay:0s}.codex-trajectory-drawer header{height:42px;flex:none;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent)}.codex-trajectory-drawer header strong{margin-right:auto}.codex-trajectory-status{opacity:.7;font-size:11px}.codex-trajectory-close{border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer}.codex-trajectory-frame{min-height:0;flex:1}.codex-trajectory-frame iframe{display:block;width:100%;height:100%;border:0}@media(max-width:899px){.codex-trajectory-drawer{width:100%;min-width:0}}';
    root.append(style); document.body.append(root);
    trigger = root.querySelector('.codex-trajectory-trigger'); drawer = root.querySelector('.codex-trajectory-drawer'); status = root.querySelector('.codex-trajectory-status');
    on(trigger, 'click', openDrawer); on(root.querySelector('.codex-trajectory-close'), 'click', close);
    on(window, 'keydown', event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } });
    on(window, 'message', event => { if (event.source === iframe?.contentWindow && event.data?.kind === 'trace-esc') close(); });
    for (const event of ['popstate', 'hashchange']) on(window, event, reconcile);
    themeTimer = setInterval(() => { if (frameReady) send(); }, 1000); routeTimer = setInterval(reconcile, 1000); reconcile();
  };
  const setV2Snapshot = snapshot => { latest = snapshot || null; setStatus(); send(); };
  const cleanup = () => {
    if (!root) return;
    clearInterval(routeTimer); clearInterval(themeTimer); listeners.splice(0).forEach(remove => remove());
    iframe?.remove(); if (frameUrl) URL.revokeObjectURL(frameUrl); root.remove();
    delete window[KEY]; delete window[STATE_KEY]; root = trigger = drawer = status = iframe = null;
  };
  window[KEY] = { setV2Snapshot, resend: send, cleanup };
  window[STATE_KEY] = { cleanup, taskId };
  build();
}

export function buildRendererSource(v2Html = '') {
  return `(${install.toString()})(${JSON.stringify(v2Html)});`;
}
