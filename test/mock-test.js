// Test del nodo contro un finto 3CX v20 (nessuna dipendenza esterna).
// Emula ciò che fa n8n: preAuthentication per il token "expirable",
// header Bearer da authenticate, nuovo login quando arriva un 401.
const http = require('http');
const assert = require('assert');
const { ThreeCxV20Api } = require('../dist/credentials/ThreeCxV20Api.credentials.js');
const { ThreeCx } = require('../dist/nodes/ThreeCx/ThreeCx.node.js');

// ------------------------------------------------------------------ finto 3CX
let validToken = null;
let loginCount = 0;
const devices = Array.from({ length: 250 }, (_, n) => ({
  Id: n + 1,
  DN: { Number: String(100 + n) },
  Registrar: { Vendor: n % 2 ? 'Yealink' : 'Fanvil', InterfaceLink: `http://admin:pw${n}@10.10.4.${n % 250}` },
}));
let lastPatch = null;

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'POST' && p === '/webclient/api/Login/GetAccessToken') {
      const b = JSON.parse(raw);
      assert.strictEqual(b.SecurityCode, '');
      if (b.Username === 'admin' && b.Password === 'secret') {
        loginCount++;
        validToken = `tok${loginCount}`;
        return send(res, 200, { Status: 'AuthSuccess', Token: { token_type: 'Bearer', access_token: validToken, refresh_token: 'r', expires_in: 60 } });
      }
      return send(res, 200, { Status: 'AuthFail' });
    }
    if (req.method === 'POST' && p === '/connect/token') {
      const f = new URLSearchParams(raw);
      assert.strictEqual(f.get('grant_type'), 'client_credentials');
      if (f.get('client_id') === 'cid' && f.get('client_secret') === 'csec') {
        loginCount++;
        validToken = `ctok${loginCount}`;
        return send(res, 200, { access_token: validToken, expires_in: 3600, token_type: 'Bearer' });
      }
      return send(res, 400, { error: 'invalid_client' });
    }

    if (req.headers.authorization !== `Bearer ${validToken}`) return send(res, 401, { error: 'unauthorized' });

    if (p === '/xapi/v1/Defs') return send(res, 200, { value: [] }, { 'X-3CX-Version': '20.0.8.1109' });
    if (p === '/xapi/v1/SystemStatus') return send(res, 200, { FQDN: 'camerana.my3cx.it', Version: '20.0.8.1109' });
    if (p === '/xapi/v1/SipDevices') {
      const filter = url.searchParams.get('$filter') || '';
      assert.ok((url.searchParams.get('$expand') || '').split(',').includes('DN'), 'DN deve essere espanso');
      const num = /DN\/Number eq '([^']*)'/.exec(filter)?.[1];
      const vendor = /Registrar\/Vendor eq '([^']*)'/.exec(filter)?.[1];
      let list = devices.filter((d) => (!num || d.DN.Number === num) && (!vendor || d.Registrar.Vendor === vendor));
      const skip = Number(url.searchParams.get('$skip') || 0);
      const top = Number(url.searchParams.get('$top') || 100);
      return send(res, 200, { '@odata.count': list.length, value: list.slice(skip, skip + top) });
    }
    if (req.method === 'PATCH' && p === '/xapi/v1/Users(5)') {
      lastPatch = JSON.parse(raw);
      res.writeHead(204); return res.end();
    }
    if (p === '/xapi/v1/Users') {
      const num = /Number eq '([^']*)'/.exec(url.searchParams.get('$filter') || '')?.[1];
      return send(res, 200, { value: num === '101' ? [{ Id: 5, Number: '101', FirstName: 'Mario' }] : [] });
    }
    send(res, 404, { error: 'not found' });
  });
});

// ------------------------------------------------------------------ finto runtime n8n
async function httpRequest(o) {
  const u = new URL(o.url.startsWith('http') ? o.url : (o.baseURL || '') + o.url);
  for (const [k, v] of Object.entries(o.qs || {})) u.searchParams.set(k, String(v));
  const headers = { ...(o.headers || {}) };
  let body = o.body;
  if (body !== undefined && typeof body === 'object') { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const r = await fetch(u, { method: o.method || 'GET', headers, body });
  const text = await r.text();
  const data = text && (r.headers.get('content-type') || '').includes('json') ? JSON.parse(text) : text;
  if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${text}`); e.httpCode = r.status; throw e; }
  return o.returnFullResponse ? { body: data, headers: Object.fromEntries(r.headers), statusCode: r.status } : data;
}

function makeContext(creds, params, items = [{ json: {} }]) {
  const credType = new ThreeCxV20Api();
  const state = { ...creds, accessToken: '' };
  const helper = { helpers: { httpRequest } };
  const authed = async (o) => {
    const h = { ...(o.headers || {}), Authorization: `Bearer ${state.accessToken}` };
    return httpRequest({ ...o, headers: h });
  };
  return {
    getInputData: () => items,
    getNodeParameter: (name, i, fallback) => (name in params ? params[name] : fallback),
    getCredentials: async () => state,
    continueOnFail: () => params.__continueOnFail === true,
    helpers: {
      async httpRequestWithAuthentication(_name, o) {
        if (!state.accessToken) Object.assign(state, await credType.preAuthentication.call(helper, state));
        try { return await authed(o); } catch (e) {
          if (e.httpCode !== 401) throw e;
          Object.assign(state, await credType.preAuthentication.call(helper, state));
          return authed(o);
        }
      },
    },
    _state: state,
  };
}

const run = (ctx) => new ThreeCx().execute.call(ctx).then((r) => r[0].map((x) => x.json));

// ------------------------------------------------------------------ test
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`; // slash finale voluto
  const pw = { serverUrl: base, authMethod: 'password', username: 'admin', password: 'secret' };

  // 1. getphone() equivalente
  let out = await run(makeContext(pw, { resource: 'sipDevice', operation: 'get', extensionNumber: '104', vendor: 'Fanvil', parseInterfaceLink: true, options: {} }));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].interface, { url: 'http://admin:pw4@10.10.4.4', ip: '10.10.4.4', port: null, username: 'admin', password: 'pw4' });
  console.log('OK  SIP device per interno + parsing InterfaceLink');

  // 2. vendor sbagliato -> errore "Telefono non trovato"; con continueOnFail -> item con error
  await assert.rejects(run(makeContext(pw, { resource: 'sipDevice', operation: 'get', extensionNumber: '105', vendor: 'Fanvil', options: {} })), /Telefono non trovato/);
  out = await run(makeContext(pw, { __continueOnFail: true, resource: 'sipDevice', operation: 'get', extensionNumber: '105', vendor: 'Fanvil', options: {} }));
  assert.match(out[0].error, /Telefono non trovato/);
  console.log('OK  telefono non trovato (errore e continueOnFail)');

  // 3. paginazione: tutti i Fanvil (125 su 250) e limite
  out = await run(makeContext(pw, { resource: 'sipDevice', operation: 'getAll', vendor: 'Fanvil', returnAll: true, options: {} }));
  assert.strictEqual(out.length, 125);
  out = await run(makeContext(pw, { resource: 'sipDevice', operation: 'getAll', vendor: '', returnAll: false, limit: 130, options: {} }));
  assert.strictEqual(out.length, 130);
  console.log('OK  paginazione $top/$skip (returnAll e limit)');

  // 4. token scaduto -> 401 -> nuovo login automatico
  const ctx = makeContext(pw, { resource: 'system', operation: 'getStatus' });
  await run(ctx);
  const before = loginCount;
  validToken = 'revocato';
  out = await run(ctx);
  assert.strictEqual(out[0].FQDN, 'camerana.my3cx.it');
  assert.strictEqual(loginCount, before + 1);
  console.log('OK  rinnovo token dopo 401');

  // 5. versione da header
  out = await run(makeContext(pw, { resource: 'system', operation: 'getVersion' }));
  assert.strictEqual(out[0].version, '20.0.8.1109');
  console.log('OK  versione da X-3CX-Version');

  // 6. utenti: get per numero e update (Id aggiunto)
  out = await run(makeContext(pw, { resource: 'user', operation: 'get', number: '101', options: {} }));
  assert.strictEqual(out[0].Id, 5);
  out = await run(makeContext(pw, { resource: 'user', operation: 'update', userId: 5, updateFields: '{"FirstName":"Luigi"}' }));
  assert.deepStrictEqual(lastPatch, { FirstName: 'Luigi', Id: 5 });
  console.log('OK  utente per numero + PATCH');

  // 7. custom request con split
  out = await run(makeContext(pw, { resource: 'custom', method: 'GET', endpoint: '/xapi/v1/SipDevices', queryParameters: '{"$top":3,"$expand":"DN"}', splitValue: true }));
  assert.strictEqual(out.length, 3);
  console.log('OK  custom XAPI request');

  // 8. login API client e password sbagliata
  out = await run(makeContext({ serverUrl: base, authMethod: 'clientCredentials', clientId: 'cid', clientSecret: 'csec' }, { resource: 'system', operation: 'getStatus' }));
  assert.ok(out[0].Version);
  await assert.rejects(run(makeContext({ ...pw, password: 'no' }, { resource: 'system', operation: 'getStatus' })), /autenticazione fallita \(Status: AuthFail\)/);
  console.log('OK  login API client + errore password');

  server.close();
  console.log('\nTutti i test superati');
})().catch((e) => { console.error('FALLITO:', e); server.close(); process.exit(1); });
