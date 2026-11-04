// Harness for extensions/pipi-cookie-sync/background.js: fake `chrome` API,
// fake pipimushroom.com probe (fires the webRequest listener the way Chrome
// does), and a mock LocWarp HTTP server on a random port. Never talks to the
// real backend or the real site.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'extensions', 'pipi-cookie-sync', 'background.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT_ID = 'abcdefghijklmnop';

// ── mock LocWarp ──
const srv = { configured: false, puts: [], gets: 0, siteDown: false, reject: false };
let server;
function startServer(port) {
  return new Promise((res) => {
    server = http.createServer((req, rsp) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        rsp.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url === '/api/pipi/status') {
          srv.gets++;
          return rsp.end(JSON.stringify({ configured: srv.configured }));
        }
        if (req.method === 'PUT' && req.url === '/api/pipi/cookie') {
          const j = JSON.parse(body);
          srv.puts.push(j);
          if (srv.siteDown) {
            return rsp.end(JSON.stringify({ configured: srv.configured, logged_in: false, error: 'pipi_unavailable', adopted: false }));
          }
          const ok = j.cookie.includes('session=') && !srv.reject;
          srv.configured = true;
          return rsp.end(JSON.stringify({ configured: true, logged_in: ok, error: ok ? null : 'pipi_login_required', adopted: true }));
        }
        rsp.statusCode = 404; rsp.end('{}');
      });
    }).listen(port || 0, '127.0.0.1', () => res(server.address().port));
  });
}

(async () => {
  const port = await startServer();

  // ── fake site + chrome ──
  // What Chrome would send: includes the non-Secure cookies that
  // chrome.cookies.getAll() leaves out.
  const site = { header: 'ASP.NET_SessionId=s1; session=a1; _ga=GA1; __gads=G1', loggedIn: true, down: false, status: 200,
    capture: true, probes: 0, onProbe: null };
  const store = {};
  const L = {};
  const badge = { text: '', title: '' };
  const on = (name) => ({ addListener: (fn, ...rest) => { L[name] = fn; L[`${name}Args`] = rest; } });
  const chrome = {
    runtime: { id: EXT_ID, onInstalled: on('installed'), onStartup: on('startup') },
    webRequest: { onBeforeSendHeaders: on('wr') },
    cookies: {
      getAll: async () => { throw new Error('getAll must not be used to build the header'); },
      onChanged: on('cookie'),
    },
    storage: { local: {
      get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, store[k]])),
      set: async (o) => Object.assign(store, o),
      remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
    } },
    action: {
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async () => {},
      setTitle: async ({ title }) => { badge.title = title; },
      onClicked: on('click'),
    },
    alarms: { create: (n, o) => { L.alarmCfg = [n, o]; }, onAlarm: on('alarm') },
  };
  const PROBE = 'https://pipimushroom.com/ApiSession.ashx';
  async function fakeFetch(url, opts = {}) {
    if (!String(url).startsWith('https://pipimushroom.com/')) return fetch(url, opts);
    assert.strictEqual(url, PROBE);
    assert.strictEqual(opts.credentials, 'include');
    site.probes++;
    if (site.down) throw new TypeError('Failed to fetch');
    // Chrome dispatches onBeforeSendHeaders before the request goes out;
    // other extensions' / pages' requests carry a different initiator.
    if (site.capture) {
      L.wr({ initiator: 'https://pipimushroom.com', url: PROBE, requestHeaders: [{ name: 'Cookie', value: 'WRONG=1' }] });
      L.wr({ initiator: `chrome-extension://${EXT_ID}`, url: PROBE,
        requestHeaders: [{ name: 'User-Agent', value: 'x' }, { name: 'Cookie', value: site.header }] });
    }
    if (site.onProbe) site.onProbe();
    await sleep(5);
    const body = { ok: true, a: 'tok', authExpiresUtc: site.loggedIn ? '2026-11-04T16:00:00Z' : null };
    return { status: site.status, json: async () => body };
  }

  const code = SRC
    .replace("'http://127.0.0.1:8777'", `'http://127.0.0.1:${port}'`)
    .replace('DEBOUNCE_MS = 3000', 'DEBOUNCE_MS = 40')
    .replace('MIN_CHANGE_GAP_MS = 60000', 'MIN_CHANGE_GAP_MS = 400')
    .replace('SELF_CHANGE_MS = 5000', 'SELF_CHANGE_MS = 100')
    .replace('CAPTURE_WAIT_MS = 2000', 'CAPTURE_WAIT_MS = 50');
  const ctx = vm.createContext({ chrome, fetch: fakeFetch, crypto: globalThis.crypto, TextEncoder, setTimeout, clearTimeout, console, Date, Promise });
  vm.runInContext(code, ctx);
  const settle = async (ms = 150) => { await sleep(ms); };
  const step = (name) => console.log(`✔ ${name} | badge=${badge.text} probes=${site.probes} puts=${srv.puts.length} gets=${srv.gets}`);

  // webRequest listener registered for the probe URL with extraHeaders (Cookie is hidden without it)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(L.wrArgs)), [{ urls: [`${PROBE}*`] }, ['requestHeaders', 'extraHeaders']]);

  L.installed(); await settle();
  assert.strictEqual(site.probes, 1);
  assert.strictEqual(srv.puts.length, 1);
  assert.strictEqual(srv.puts[0].source, 'extension');
  assert.strictEqual(srv.puts[0].cookie, site.header, 'header pushed verbatim, as Chrome sent it');
  assert.strictEqual(badge.text, '✓');
  assert.strictEqual(JSON.stringify(L.alarmCfg), JSON.stringify(['pipi-cookie-check', { periodInMinutes: 1 }]));
  assert.deepStrictEqual(Object.keys(store).sort(), ['lastHash', 'state']);
  assert.ok(/^[0-9a-f]{64}$/.test(store.lastHash), 'only a sha256 hash is stored');
  step('install: captured Cookie header (incl. non-Secure cookies) pushed verbatim, only hash stored');

  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(site.probes, 1); assert.strictEqual(srv.puts.length, 1);
  step('alarm, in sync: site not contacted, no push');

  L.cookie({ cookie: { name: '_ga', domain: '.pipimushroom.com' } }); await settle();
  assert.strictEqual(site.probes, 1);
  step('analytics cookie change ignored');

  await sleep(400); // past the change gap
  site.header = 'ASP.NET_SessionId=s1; session=a2; _ga=GA1; __gads=G1';
  for (let i = 0; i < 3; i++) L.cookie({ cookie: { name: 'session', domain: 'pipimushroom.com' } });
  L.cookie({ cookie: { name: 'x', domain: 'evil.com' } });
  await settle();
  assert.strictEqual(site.probes, 2); assert.strictEqual(srv.puts.length, 2);
  assert.ok(srv.puts[1].cookie.includes('session=a2'));
  step('login cookie change: burst debounced into one probe + push, other domains ignored');

  await sleep(120); // past the self-change window of the last probe, still inside the gap
  site.header = 'ASP.NET_SessionId=s1; session=a3; _ga=GA1; __gads=G1';
  L.cookie({ cookie: { name: 'session', domain: 'pipimushroom.com' } }); await settle(60);
  assert.strictEqual(site.probes, 2, 'second change inside the gap waits');
  await settle(450);
  assert.strictEqual(site.probes, 3); assert.strictEqual(srv.puts.length, 3);
  step('changes are synced at most once per gap (trailing sync)');

  await sleep(400);
  site.onProbe = () => L.cookie({ cookie: { name: 'ASP.NET_SessionId', domain: 'pipimushroom.com' } });
  L.click(); await settle(700);
  site.onProbe = null;
  assert.strictEqual(site.probes, 4, 'cookie set by our own probe does not trigger another probe');
  assert.strictEqual(srv.puts.length, 4, 'click forces a push');
  step('click forces sync; cookies set by our own probe are not a change (no loop)');

  site.header = 'ASP.NET_SessionId=s1; session=a3; _ga=GA9; __gads=G9';
  L.startup(); await settle();
  assert.strictEqual(site.probes, 5); assert.strictEqual(srv.puts.length, 4);
  assert.strictEqual(badge.text, '✓');
  step('startup: probe, only analytics differ -> no push');

  srv.configured = false;
  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(site.probes, 6); assert.strictEqual(srv.puts.length, 5);
  step('LocWarp lost the cookie: alarm re-probes and pushes');

  await new Promise((r) => server.close(r));
  L.click(); await settle();
  assert.strictEqual(badge.text, '×'); assert.strictEqual(site.probes, 6, 'site not contacted while LocWarp is down');
  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(site.probes, 6);
  await startServer(port); srv.configured = true;
  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(site.probes, 7); assert.strictEqual(srv.puts.length, 6); assert.strictEqual(badge.text, '✓');
  step('LocWarp down: badge ×, site untouched; back up: alarm syncs');

  site.down = true; L.click(); await settle();
  assert.strictEqual(badge.text, '?'); assert.ok(!('state' in store));
  site.down = false; L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(badge.text, '✓');
  step('site unreachable: badge ?, next alarm retries');

  site.status = 429; L.click(); await settle();
  assert.strictEqual(badge.text, '?'); assert.ok(badge.title.includes('限流'));
  site.status = 200; L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(badge.text, '✓');
  step('rate limited: badge ?, retried');

  site.capture = false; L.click(); await settle();
  assert.strictEqual(badge.text, '?'); assert.ok(badge.title.includes('擷取'));
  site.capture = true; L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(badge.text, '✓');
  step('header not captured: badge ?, retried');

  site.loggedIn = false; site.header = 'ASP.NET_SessionId=s2; _ga=GA9';
  const putsBefore = srv.puts.length;
  L.click(); await settle();
  assert.strictEqual(badge.text, '!'); assert.ok(badge.title.includes('沒有登入'), badge.title);
  assert.strictEqual(srv.puts.length, putsBefore, 'logged-out cookie is not pushed');
  const probesOut = site.probes;
  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(site.probes, probesOut, 'no polling while logged out');
  step('profile logged out: badge !, nothing pushed, alarm waits');

  await sleep(400);
  site.loggedIn = true; site.header = 'ASP.NET_SessionId=s2; session=b1; _ga=GA9';
  L.cookie({ cookie: { name: 'session', domain: 'pipimushroom.com' } }); await settle();
  assert.strictEqual(badge.text, '✓'); assert.strictEqual(srv.puts.length, putsBefore + 1);
  step('login afterwards: cookie change syncs');

  await sleep(400);
  srv.reject = true; site.header = 'ASP.NET_SessionId=s2; session=b2; _ga=GA9';
  L.click(); await settle();
  assert.strictEqual(badge.text, '!'); assert.ok(badge.title.includes('驗證失敗'), badge.title);
  const probesRej = site.probes;
  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(site.probes, probesRej, 'rejected cookie is not retried in a loop');
  srv.reject = false;
  L.click(); await settle();
  assert.strictEqual(badge.text, '✓');
  step('LocWarp rejects a logged-in cookie: badge !, no loop, click retries');

  await sleep(400);
  site.header = 'ASP.NET_SessionId=s2; session=b3; _ga=GA9';
  L.cookie({ cookie: { name: 'session', domain: 'pipimushroom.com' } });
  vm.runInContext('clearTimeout(debounceTimer)', ctx); // worker suspended before the timer fired
  await settle();
  assert.strictEqual(store.dirty, true);
  const putsDirty = srv.puts.length;
  L.alarm({ name: 'pipi-cookie-check' }); await settle();
  assert.strictEqual(srv.puts.length, putsDirty + 1); assert.ok(!('dirty' in store));
  step('worker suspended mid-debounce: alarm picks up the pending change');

  server.close();
  console.log('ALL EXTENSION TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
