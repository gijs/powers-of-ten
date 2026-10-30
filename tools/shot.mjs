// Screenshot the harness, waiting for content to actually be loaded.
//
//   node tools/shot.mjs <url> <out.png> [--width 1000] [--height 760] [--wait-ms 15000]
//
// Chrome's --screenshot flag needs --virtual-time-budget to let a page settle,
// but virtual time races ahead of the real network: a page that fetches a
// couple of megabytes gets captured before the fetch resolves, and the result
// is a convincingly empty frame. This drives Chrome over the DevTools protocol
// instead and waits on the page's own readiness signal (`stage.loading`), so
// what lands in the PNG is what a person would see.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const url = positional[0];
const out = positional[1];
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [--width W] [--height H] [--wait-ms N]');
  process.exit(1);
}
const width = Number(flag('width', 1000));
const height = Number(flag('height', 760));
const waitMs = Number(flag('wait-ms', 15000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'pot-shot-'));
// Port 0 lets Chrome pick a free one, which it reports in DevToolsActivePort.
// A fixed port makes back-to-back runs race: the next launch can attach to the
// previous instance as it exits, and capture a page that never initialised.
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  // Chrome may still be flushing its profile as we tear down; the temp dir is
  // disposable either way, so never let this fail the run.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
};
process.on('exit', cleanup);

let port = null;
for (let i = 0; i < 150 && port === null; i++) {
  try {
    const [line] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
    if (line) port = Number(line);
  } catch { await sleep(100); }
}
if (port === null) throw new Error('Chrome never reported a DevTools port');

async function endpoint(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

let version = null;
for (let i = 0; i < 100 && !version; i++) {
  try { version = await endpoint('/json/version'); } catch { await sleep(100); }
}
if (!version) throw new Error('Chrome DevTools endpoint never came up');

// Open a blank tab and navigate explicitly, so we can wait on the load event.
// Creating the tab straight on the target URL races: the readiness poll below
// can start in the about:blank context, which is then torn down by the
// navigation, and the poll sits there watching a dead context until it times out.
const target = await endpoint('/json/new?about:blank', 'PUT');

ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
const eventWaiters = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method) {
    const waiters = eventWaiters.get(msg.method);
    if (waiters) { eventWaiters.delete(msg.method); for (const r of waiters) r(msg.params); }
    return;
  }
  const slot = pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
};
const waitForEvent = (method) => new Promise((resolve) => {
  if (!eventWaiters.has(method)) eventWaiters.set(method, []);
  eventWaiters.get(method).push(resolve);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');

const loaded = waitForEvent('Page.loadEventFired');
await send('Page.navigate', { url });
await Promise.race([loaded, sleep(waitMs)]);

// Poll the page's own state rather than guessing at a delay.
//
// Deliberately many short evaluates rather than one long in-page promise: a
// single long-lived evaluate binds to whichever execution context was current
// when it started, and if that context is replaced it waits out the full
// timeout watching a context nobody lives in any more. Re-evaluating each time
// always targets the live context.
const deadline = Date.now() + waitMs;
let state = { ok: false, reason: 'timed out waiting for stage' };
while (Date.now() < deadline) {
  const probe = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      if (!globalThis.stage) return { ok: false, loading: undefined };
      return { ok: !globalThis.stage.loading && globalThis.stage.liveCount > 0,
               loading: globalThis.stage.loading,
               live: globalThis.stage.liveCount,
               s: globalThis.director.s };
    })()`,
  }).catch(() => null);

  const value = probe?.result?.value;
  if (value?.ok) {
    // Two more frames so a band that just became ready is actually drawn.
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
    });
    state = { ok: true, live: value.live, s: value.s };
    break;
  }
  if (value) state.loading = value.loading;
  await sleep(150);
}
if (!state.ok) {
  console.error(`error: ${state.reason} (loading=${state.loading})`);
  cleanup();
  process.exit(2);
} else {
  console.log(`ready: ${state.live} live band(s) at s=${state.s.toFixed(2)}`);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`wrote ${out}`);

cleanup();
process.exit(0);
