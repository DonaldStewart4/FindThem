// A tiny Chrome DevTools Protocol driver: open tabs in a headless Chrome and run code in them.
export class Tab {
  static async open(port, url = 'about:blank') {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const info = await res.json();
    const tab = new Tab();
    tab.ws = new WebSocket(info.webSocketDebuggerUrl);
    tab.nextId = 1; tab.waiting = new Map(); tab.console = []; tab.errors = [];
    await new Promise((ok, bad) => { tab.ws.onopen = ok; tab.ws.onerror = bad; });
    tab.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && tab.waiting.has(m.id)) { const w = tab.waiting.get(m.id); tab.waiting.delete(m.id); m.error ? w.bad(new Error(JSON.stringify(m.error))) : w.ok(m.result); return; }
      if (m.method === 'Runtime.consoleAPICalled') tab.console.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      if (m.method === 'Runtime.exceptionThrown') tab.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') tab.errors.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
    };
    await tab.send('Runtime.enable'); await tab.send('Log.enable'); await tab.send('Page.enable');
    return tab;
  }
  send(method, params = {}) { const id = this.nextId++; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, bad) => this.waiting.set(id, { ok, bad })); }
  async go(url) { await this.send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 1500)); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression, timeoutMs = 30000, label = expression) {
    const t0 = Date.now();
    for (;;) { if (await this.eval(expression)) return Date.now() - t0; if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for: ' + label); await new Promise((r) => setTimeout(r, 100)); }
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Closes every page left open in the headless Chrome. Call it at the start of a script: tabs
// from earlier runs keep their live database connections, and a browser only allows a handful
// of connections per site, so leftover tabs make the next shared-search check hang.
export async function closeAllTabs(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  for (const t of list) if (t.type === 'page') await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
}
