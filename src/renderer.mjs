function install(mazeHtml, v2Html) {
  const KEY = '__CODEX_TRAJECTORY__';
  const STATE_KEY = '__CODEX_TRAJECTORY_STATE__';
  const ROOT_ID = 'codex-trajectory-root';
  const routeRe = /\/thread\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\/?#]|$)/i;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const old = window[KEY];
  if (old && typeof old.cleanup === 'function') old.cleanup();

  let root = null;
  let menuHost = null;
  let menuTrigger = null;
  let button = null;
  let v2Button = null;
  let compareButton = null;
  let menuPanel = null;
  let drawer = null;
  let drawerTitle = null;
  let closeButton = null;
  let status = null;
  let iframe = null;
  let frameUrl = null;
  let frameReady = false;
  let frameMode = null;
  const frames = new Map();
  let latest = null;
  let latestV2 = null;
  let open = false;
  let menuOpen = false;
  let opener = null;
  let menuLayout = '';
  let routeTimer = null;
  let themeTimer = null;
  let cleanupDone = false;
  const listeners = [];
  const MENU_ORIGIN = { left: 252, top: 52 };

  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const taskId = () => {
    const match = routeRe.exec(location.href);
    if (match) return match[1].toLowerCase();
    const value = document.querySelector('[data-app-action-sidebar-thread-selected="true"]')?.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^local:/, '') || '';
    return uuidRe.test(value) ? value.toLowerCase() : null;
  };
  const theme = () => {
    const rootNode = document.documentElement;
    const value = rootNode?.dataset?.theme || document.body?.dataset?.theme || '';
    if (/dark/i.test(value) || rootNode?.classList.contains('dark') || document.body?.classList.contains('dark')) return 'dark';
    return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const locale = () => /^zh\b/i.test(document.documentElement.lang || navigator.language || '') ? 'zh' : 'en';
  const sendAppearance = () => {
    if (!iframe) return;
    if (frameMode === 'trajectory') {
      iframe.contentWindow?.postMessage({ kind: 'trace-theme', mode: theme() }, '*');
      iframe.contentWindow?.postMessage({ kind: 'trace-locale', lang: locale() }, '*');
    }
    if (frameMode === 'v2') {
      iframe.contentWindow?.postMessage({ kind: 'trajectory-v2:theme', mode: theme() }, '*');
      iframe.contentWindow?.postMessage({ kind: 'trajectory-v2:locale', lang: locale() }, '*');
    }
  };
  const send = () => {
    if (!iframe) return;
    if (frameMode === 'trajectory' && latest) iframe.contentWindow?.postMessage({ kind: 'trace-maze', data: latest.data }, '*');
    if (frameMode === 'v2' && latestV2) iframe.contentWindow?.postMessage({ kind: 'trajectory-v2:snapshot', data: latestV2.data }, '*');
    sendAppearance();
  };
  const setStatus = () => {
    if (!status) return;
    const current = frameMode === 'v2' ? latestV2 : latest;
    const value = current?.status || 'loading';
    const text = current?.diagnostics ? value + ' · ' + current.diagnostics : value;
    if (status.textContent !== text) status.textContent = text;
    if (status.dataset.status !== value) status.dataset.status = value;
  };
  const close = () => {
    open = false;
    drawer?.setAttribute('aria-hidden', 'true');
    opener?.setAttribute('aria-expanded', 'false');
    opener?.focus();
  };
  const closeMenu = () => {
    menuOpen = false;
    menuPanel?.setAttribute('hidden', '');
    menuTrigger?.setAttribute('aria-expanded', 'false');
  };
  const toggleMenu = () => {
    menuOpen = !menuOpen;
    if (menuOpen) menuPanel?.removeAttribute('hidden');
    else menuPanel?.setAttribute('hidden', '');
    menuTrigger?.setAttribute('aria-expanded', String(menuOpen));
  };
  const placeMenu = () => {
    if (!menuHost || menuLayout) return;
    menuHost.classList.add('is-mounted');
    menuLayout = 'fixed';
    menuHost.style.top = MENU_ORIGIN.top + 'px';
    menuHost.style.left = MENU_ORIGIN.left + 'px';
  };
  const removeFrames = () => {
    for (const record of frames.values()) {
      record.iframe.remove();
      URL.revokeObjectURL(record.url);
    }
    frames.clear();
    iframe = null;
    frameReady = false;
    frameMode = null;
    frameUrl = null;
  };
  const openDrawer = (mode) => {
    if ((mode === 'trajectory' || mode === 'v2') && !taskId()) return;
    closeMenu();
    open = true;
    opener = mode === 'compare' ? compareButton : mode === 'v2' ? v2Button : button;
    drawerTitle.textContent = mode === 'compare' ? 'Trace 对比' : mode === 'v2' ? 'Trajectory V2 · 实时分析' : 'Trajectory · 旧版';
    status.hidden = mode === 'compare';
    drawer?.setAttribute('aria-hidden', 'false');
    opener?.setAttribute('aria-expanded', 'true');
    if (iframe) iframe.hidden = true;
    const existing = frames.get(mode);
    if (existing) {
      frameMode = mode;
      iframe = existing.iframe;
      frameUrl = existing.url;
      frameReady = existing.ready;
      iframe.hidden = false;
    } else {
      frameMode = mode;
      frameReady = false;
      iframe = document.createElement('iframe');
      iframe.title = mode === 'compare' ? 'Trace Compare' : mode === 'v2' ? 'Codex Trajectory V2' : 'Codex Trajectory Maze';
      iframe.sandbox = 'allow-scripts allow-modals allow-downloads';
      frameUrl = URL.createObjectURL(new Blob([mode === 'v2' ? v2Html : mazeHtml], { type: 'text/html' }));
      iframe.src = frameUrl + (mode === 'compare' ? '#codex-trace-compare' : mode === 'v2' ? '#trajectory-v2' : '#codex-trajectory-maze');
      const record = { iframe, url: frameUrl, ready: false };
      frames.set(mode, record);
      iframe.addEventListener('load', () => {
        record.ready = true;
        if (frameMode === mode) { frameReady = true; send(); }
      }, { once: true });
      drawer?.querySelector('.codex-trajectory-frame')?.append(iframe);
      setTimeout(send, 250);
      setTimeout(send, 1000);
    }
    setStatus();
    send();
  };
  const reconcile = () => {
    const valid = Boolean(taskId());
    if (button) button.disabled = !valid;
    if (v2Button) v2Button.disabled = !valid;
    if (menuHost) menuHost.hidden = !valid;
    if (!valid) closeMenu();
    if (!valid && open && (frameMode === 'trajectory' || frameMode === 'v2')) close();
    placeMenu();
    setStatus();
  };
  const build = () => {
    if (root || !document.body) return;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '<div class="codex-trajectory-menu"><button type="button" class="codex-trajectory-menu-trigger" aria-label="Open Trajectory menu" title="Trajectory" aria-haspopup="menu" aria-controls="codex-trajectory-menu-items" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M4 24C4 24 6 4 14 4C22 4 23 19 24 24C25 29 28 44 35 44C42 44 44 24 44 24" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 24H17M31 24H37" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div id="codex-trajectory-menu-items" class="codex-trajectory-menu-items" role="menu" hidden><button type="button" class="codex-trajectory-menu-item" role="menuitem">实时分析 V2</button><button type="button" class="codex-trajectory-menu-item" role="menuitem">当前任务轨迹（旧版）</button><button type="button" class="codex-trajectory-menu-item" role="menuitem">⇄ Trace 对比</button></div></div>' +
      '<section id="codex-trajectory-drawer" class="codex-trajectory-drawer" aria-hidden="true" role="dialog" aria-label="Trajectory"><header><strong class="codex-trajectory-title">Trajectory</strong><span class="codex-trajectory-status">loading</span><button type="button" class="codex-trajectory-close" aria-label="Close Trajectory">×</button></header><div class="codex-trajectory-frame"></div></section>';
    const style = document.createElement('style');
    style.textContent = '#codex-trajectory-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:13px -apple-system,BlinkMacSystemFont,sans-serif}.codex-trajectory-menu{pointer-events:auto;position:fixed;z-index:1;visibility:hidden}.codex-trajectory-menu[hidden]{display:none}.codex-trajectory-menu.is-mounted{visibility:visible}.codex-trajectory-menu-trigger{display:grid;place-items:center;width:28px;height:28px;padding:4px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:8px;background:Canvas;color:CanvasText;cursor:pointer}.codex-trajectory-menu-trigger:hover{background:color-mix(in srgb,CanvasText 6%,transparent)}.codex-trajectory-menu-trigger svg{width:18px;height:18px}.codex-trajectory-menu-items{position:absolute;top:calc(100% + 4px);left:0;z-index:1;min-width:max-content;padding:4px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:10px;box-shadow:0 8px 20px #0002}.codex-trajectory-menu-items[hidden]{display:none}.codex-trajectory-menu-item{display:block;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-weight:400!important;text-align:left;white-space:nowrap;cursor:pointer}.codex-trajectory-menu-item:hover{background:color-mix(in srgb,CanvasText 8%,transparent)}.codex-trajectory-menu-item:disabled{opacity:.45;cursor:default}.codex-trajectory-drawer{pointer-events:auto;position:fixed;right:0;top:0;height:100%;width:min(72vw,1200px);min-width:560px;background:Canvas;color:CanvasText;box-shadow:none;visibility:hidden;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .18s ease,visibility 0s linear .18s}.codex-trajectory-drawer[aria-hidden="false"]{transform:translateX(0);visibility:visible;box-shadow:-8px 0 28px #0004;transition-delay:0s}.codex-trajectory-drawer header{height:42px;flex:none;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent)}.codex-trajectory-title{margin-right:auto}.codex-trajectory-status{opacity:.7;font-size:11px}.codex-trajectory-close{border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer}.codex-trajectory-frame{min-height:0;flex:1}.codex-trajectory-frame iframe{display:block;width:100%;height:100%;border:0}@media(max-width:899px){.codex-trajectory-drawer{width:100%;min-width:0}}';
    style.textContent += '.codex-trajectory-drawer{width:calc(100vw - 300px)}@media(max-width:899px){.codex-trajectory-drawer{width:100%;min-width:0}}';
    root.append(style);
    document.body.append(root);
    menuHost = root.querySelector('.codex-trajectory-menu');
    menuTrigger = root.querySelector('.codex-trajectory-menu-trigger');
    v2Button = root.querySelectorAll('.codex-trajectory-menu-item')[0];
    button = root.querySelectorAll('.codex-trajectory-menu-item')[1];
    compareButton = root.querySelectorAll('.codex-trajectory-menu-item')[2];
    menuPanel = root.querySelector('.codex-trajectory-menu-items');
    drawer = root.querySelector('.codex-trajectory-drawer');
    drawerTitle = root.querySelector('.codex-trajectory-title');
    closeButton = root.querySelector('.codex-trajectory-close');
    status = root.querySelector('.codex-trajectory-status');
    on(menuTrigger, 'click', toggleMenu);
    on(v2Button, 'click', () => openDrawer('v2'));
    on(button, 'click', () => openDrawer('trajectory'));
    on(compareButton, 'click', () => openDrawer('compare'));
    on(closeButton, 'click', close);
    on(window, 'keydown', event => { if (event.key === 'Escape') { if (menuOpen) { event.preventDefault(); closeMenu(); } else if (open) { event.preventDefault(); close(); } } });
    on(document, 'pointerdown', event => { if (menuOpen && !menuHost?.contains(event.target)) closeMenu(); });
    on(window, 'message', event => { if (event.source === iframe?.contentWindow && event.data?.kind === 'trace-esc') close(); });
    for (const event of ['popstate', 'hashchange']) on(window, event, reconcile);
    themeTimer = setInterval(() => { if (frameReady) sendAppearance(); }, 1000);
    routeTimer = setInterval(reconcile, 1000);
    reconcile();
  };
  const setSnapshot = snapshot => {
    latest = snapshot || null;
    setStatus();
    send();
  };
  const setV2Snapshot = snapshot => {
    latestV2 = snapshot || null;
    setStatus();
    send();
  };
  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    if (routeTimer) clearInterval(routeTimer);
    if (themeTimer) clearInterval(themeTimer);
    listeners.splice(0).forEach(remove => remove());
    menuHost?.remove();
    root?.remove();
    removeFrames();
    root = menuHost = menuTrigger = button = v2Button = compareButton = menuPanel = drawer = drawerTitle = closeButton = status = iframe = opener = null;
    menuLayout = '';
    delete window[KEY];
    delete window[STATE_KEY];
  };
  window[KEY] = { setSnapshot, setV2Snapshot, resend: send, cleanup };
  window[STATE_KEY] = { setSnapshot, cleanup, taskId };
  build();
}

export function buildRendererSource(mazeHtml, v2Html = '') {
  return '(' + install.toString() + ')(' + JSON.stringify(mazeHtml) + ',' + JSON.stringify(v2Html) + ');';
}
