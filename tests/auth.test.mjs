import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { authApi } from '../auth-api.mjs';
import { accountStore } from '../account-store.mjs';
import { oauthConfig, verifiedIdentity } from '../auth.mjs';
import { seed } from '../dist/model.js';

test('el acceso exige correo verificado, credencial de esta app y nonce', () => {
  const id = 'example-client';
  const claims = { iss: 'https://accounts.google.com', aud: id, exp: 2_000, iat: 900, nonce: 'proof',
    email_verified: true, email: 'Coach@Example.com', sub: 'coach' };
  assert.deepEqual(verifiedIdentity(claims, id, 'proof', 1_000), { email: 'coach@example.com', subject: 'coach' });
  for (const bad of [{ email_verified: false }, { exp: 1_000 }, { aud: 'other-app' }, { nonce: 'other-attempt' }]) {
    assert.throws(() => verifiedIdentity({ ...claims, ...bad }, id, 'proof', 1_000), /no se pudo verificar/);
  }
  assert.throws(() => oauthConfig({ CRM_MODE: 'google' }), /Falta CRM_ORIGIN/);
});

test('la API solo abre fichas invitadas, aísla los datos y revoca sesiones', async t => {
  const adminEmail = 'coach@example.com';
  const store = accountStore(':memory:', adminEmail);
  const identities = {
    owner: { email: adminEmail, subject: 'owner' },
    invited: { email: 'lucia@example.com', subject: 'invited' },
    wrongSubject: { email: 'lucia@example.com', subject: 'different' },
    other: { email: 'someone@example.com', subject: 'other' }
  };
  let handler;
  const server = createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost')));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = oauthConfig({ CRM_MODE: 'google', CRM_ORIGIN: origin, CRM_ADMIN_EMAIL: adminEmail,
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-placeholder' });
  const sentMail = [];
  handler = authApi(config, store, { exchange: async (_, flow, code) => {
    assert.ok(flow.nonce && flow.verifier);
    return identities[code];
  }, sendLogin: async (email, link) => { sentMail.push({ email, link }); } });
  const cookieFrom = (response, name) => response.headers.getSetCookie().find(item => item.startsWith(name + '='))?.split(';')[0];
  async function login(code) {
    const start = await fetch(origin + '/api/auth/google', { redirect: 'manual' });
    const url = new URL(start.headers.get('location'));
    assert.equal(url.searchParams.get('scope'), 'openid email');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const callback = '/api/auth/google/callback?code=' + code + '&state=' + url.searchParams.get('state');
    const cookie = cookieFrom(start, 'dl-flow');
    const response = await fetch(origin + callback, { redirect: 'manual', headers: { cookie } });
    const replay = await fetch(origin + callback, { redirect: 'manual', headers: { cookie } });
    assert.equal(replay.headers.get('location'), '/?access=cancelled');
    return { outcome: response.headers.get('location'), cookie: cookieFrom(response, 'dl-session') };
  }
  const read = cookie => fetch(origin + '/api/session', { headers: { cookie } }).then(response => response.json());
  const emailPost = (path, body) => fetch(origin + '/api/auth/email' + path, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const write = (cookie, snapshot, source = origin) => fetch(origin + '/api/state', {
    method: 'POST', headers: { cookie, origin: source, 'content-type': 'application/json' },
    body: JSON.stringify(snapshot)
  });
  const owner = await login('owner');
  assert.equal(owner.outcome, '/');
  const initial = await read(owner.cookie);
  assert.equal(initial.user.role, 'coach');
  assert.equal(initial.data.clients.length, 0);
  assert.equal((await login('other')).outcome, '/?access=invite');
  assert.equal((await login('invited')).outcome, '/?access=invite');
  assert.equal((await emailPost('', { email: identities.invited.email })).status, 202);
  assert.equal(sentMail.length, 0);

  const data = { ...seed(), resources: [] };
  data.clients[0].accessEnabled = true;
  data.clients[0].coachNotes = 'Solo para el entrenador';
  assert.equal((await write(owner.cookie, { data, revision: 0 }, 'https://otro.test')).status, 403);
  assert.equal((await write(owner.cookie, { data, revision: 0 })).status, 200);

  assert.equal((await emailPost('', { email: adminEmail })).status, 202);
  assert.equal(sentMail.length, 0);
  assert.equal((await emailPost('', { email: identities.invited.email })).status, 202);
  assert.equal((await emailPost('', { email: identities.invited.email })).status, 202);
  assert.equal(sentMail.length, 1);
  const emailToken = new URLSearchParams(new URL(sentMail[0].link).hash.slice(1)).get('acceso-email');
  const emailSession = await emailPost('/confirm', { token: emailToken });
  assert.equal(emailSession.status, 200);
  const emailCookie = cookieFrom(emailSession, 'dl-session');
  assert.equal((await read(emailCookie)).user.email, identities.invited.email);
  assert.equal((await emailPost('/confirm', { token: emailToken })).status, 400);

  const invited = await login('invited');
  assert.equal(invited.outcome, '/');
  assert.equal((await login('wrongSubject')).outcome, '/?access=invite');
  const client = await read(invited.cookie);
  assert.equal(client.user.role, 'client');
  assert.deepEqual(client.data.clients.map(item => item.email), ['lucia@example.com']);
  assert.equal(client.data.clients[0].coachNotes, undefined);
  assert.deepEqual(client.data.agenda, []);

  const forbidden = structuredClone(client);
  forbidden.data.clients[0].accessEnabled = true;
  assert.equal((await write(invited.cookie, forbidden)).status, 400);
  const altered = structuredClone(client);
  altered.data.clients[0].week.exercises[0].sets[0].rir = '0';
  assert.equal((await write(invited.cookie, altered)).status, 200);
  assert.equal((await write(invited.cookie, altered)).status, 409);

  const latest = await read(owner.cookie);
  assert.equal(latest.data.clients[0].week.exercises[0].sets[0].rir, '0');
  latest.data.clients[0].accessEnabled = false;
  assert.equal((await write(owner.cookie, latest)).status, 200);
  assert.equal((await read(invited.cookie)).user, null);
  assert.equal((await read(emailCookie)).user, null);
});
