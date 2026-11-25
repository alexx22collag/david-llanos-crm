import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

const endpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  keys: 'https://www.googleapis.com/oauth2/v3/certs'
};

export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const randomToken = () => randomBytes(32).toString('base64url');
export const tokenHash = value => createHash('sha256').update(value).digest('base64url');

export function getAccess(email, clients, adminEmail) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (normalized === adminEmail) return { role: 'coach', email: normalized };
  const client = clients.find(item => item.accessEnabled === true && normalizeEmail(item.email) === normalized);
  return client ? { role: 'client', email: normalized, clientId: client.id } : null;
}

export function oauthConfig(env) {
  if (!['demo', 'google'].includes(env.CRM_MODE ?? 'demo')) throw Error('CRM_MODE debe ser demo o google.');
  if (env.CRM_MODE !== 'google') return null;
  for (const name of ['CRM_ORIGIN', 'CRM_ADMIN_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    if (!env[name]?.trim()) throw Error('Falta ' + name + ' para activar el acceso Google.');
  }
  const url = new URL(env.CRM_ORIGIN);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.href !== url.origin + '/') {
    throw Error('CRM_ORIGIN debe ser un origen HTTPS, o HTTP en desarrollo local.');
  }
  const adminEmail = normalizeEmail(env.CRM_ADMIN_EMAIL);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw Error('CRM_ADMIN_EMAIL debe ser un correo válido.');
  return {
    origin: url.origin, secure: url.protocol === 'https:', adminEmail,
    clientId: env.GOOGLE_CLIENT_ID.trim(), secret: env.GOOGLE_CLIENT_SECRET.trim(),
    redirect: url.origin + '/api/auth/google/callback'
  };
}

export function authorizeUrl(config, flow) {
  const url = new URL(endpoints.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirect, response_type: 'code',
    scope: 'openid email', state: flow.state, nonce: flow.nonce,
    code_challenge: tokenHash(flow.verifier), code_challenge_method: 'S256', prompt: 'select_account'
  });
  return url.href;
}

let googleKeys;
async function signingKey(kid) {
  if (googleKeys?.expires > Date.now() && googleKeys.keys.has(kid)) return googleKeys.keys.get(kid);
  const response = await fetch(endpoints.keys, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Error('Google no pudo verificar la sesión.');
  const { keys } = await response.json();
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 0);
  googleKeys = {
    expires: Date.now() + maxAge * 1000,
    keys: new Map(keys.filter(key => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig')
      .map(key => [key.kid, createPublicKey({ key, format: 'jwk' })]))
  };
  return googleKeys.keys.get(kid);
}

export function verifiedIdentity(claims, clientId, nonce, now = Math.floor(Date.now() / 1000)) {
  const email = normalizeEmail(claims.email);
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.aud !== clientId || (claims.azp != null && claims.azp !== clientId) ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
      claims.nonce !== nonce || claims.email_verified !== true ||
      !email || typeof claims.sub !== 'string' || !claims.sub) {
    throw Error('La cuenta de Google no se pudo verificar.');
  }
  return { email, subject: claims.sub };
}

export async function exchangeGoogleCode(config, flow, code) {
  const response = await fetch(endpoints.token, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.secret,
      redirect_uri: config.redirect, code_verifier: flow.verifier, code
    })
  });
  if (!response.ok) throw Error('Google no pudo abrir la sesión.');
  const { id_token: token } = await response.json();
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts.some(part => !part || !/^[A-Za-z0-9_-]+$/.test(part))) throw Error('Credencial no válida.');
  const [header, payload, signature] = parts;
  const { alg, kid } = JSON.parse(Buffer.from(header, 'base64url'));
  if (alg !== 'RS256' || typeof kid !== 'string') throw Error('Firma no válida.');
  const key = await signingKey(kid);
  if (!key || !verify('RSA-SHA256', Buffer.from(header + '.' + payload), key, Buffer.from(signature, 'base64url'))) {
    throw Error('Firma de Google no válida.');
  }
  return verifiedIdentity(JSON.parse(Buffer.from(payload, 'base64url')), config.clientId, flow.nonce);
}
