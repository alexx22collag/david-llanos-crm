import { authorizeUrl, exchangeGoogleCode, normalizeEmail } from './auth.mjs';

const sessionAge = 60 * 60 * 12;
const maxBody = 5 * 1024 * 1024;
const escapeCookie = (name, value, seconds, secure) =>
  name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + seconds + (secure ? '; Secure' : '');
function cookie(req, name) {
  return (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
}
function redirect(res, location, cookies) {
  res.writeHead(303, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end();
}
async function jsonBody(req, limit = maxBody) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('El registro supera el tamaño permitido.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function authApi(config, store, { exchange = exchangeGoogleCode, sendLogin = null } = {}) {
  const sendLimits = new Map();
  function emailRequestsAllowed(address) {
    const now = Date.now();
    for (const [key, value] of sendLimits) if (value.expires <= now) sendLimits.delete(key);
    if (!sendLimits.has(address) && sendLimits.size >= 1_000) return false;
    const entry = sendLimits.get(address) || { count: 0, expires: now + 600_000 };
    if (entry.count >= 10) return false;
    entry.count += 1;
    sendLimits.set(address, entry);
    return true;
  }
  return async (req, res, url) => {
    const { pathname } = url;
    const sessionCookie = config?.secure ? '__Host-dl-session' : 'dl-session';
    const flowCookie = config?.secure ? '__Host-dl-flow' : 'dl-flow';
    const token = cookie(req, sessionCookie);

    if (pathname === '/api/session' && req.method === 'GET') {
      return json(res, 200, config ? { mode: 'google', emailLogin: Boolean(sendLogin), ...(store.read(token) || { user: null }) } : { mode: 'demo' });
    }
    if (!config) return json(res, 404, { error: 'Google no está configurado en este servidor.' });
    if (pathname === '/api/auth/google' && req.method === 'GET') {
      const flow = store.newFlow();
      return redirect(res, authorizeUrl(config, flow), escapeCookie(flowCookie, flow.state, 600, config.secure));
    }
    if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
      const key = url.searchParams.get('state');
      const expireFlow = escapeCookie(flowCookie, '', 0, config.secure);
      try {
        const flow = key && key === cookie(req, flowCookie) ? store.takeFlow(key) : null;
        const code = url.searchParams.get('code');
        if (!flow || !code || url.searchParams.has('error')) return redirect(res, '/?access=cancelled', expireFlow);
        const identity = await exchange(config, flow, code);
        const newToken = store.signIn(identity, sessionAge);
        if (!newToken) {
          store.signOut(token);
          return redirect(res, '/?access=invite', [expireFlow, escapeCookie(sessionCookie, '', 0, config.secure)]);
        }
        store.signOut(token);
        return redirect(res, '/', [expireFlow, escapeCookie(sessionCookie, newToken, sessionAge, config.secure)]);
      } catch {
        return redirect(res, '/?access=failed', expireFlow);
      }
    }
    if (req.method === 'POST' && req.headers.origin !== config.origin) {
      return json(res, 403, { error: 'Origen de la solicitud no permitido.' });
    }
    if (req.method === 'POST' && ['/api/auth/email', '/api/auth/email/confirm'].includes(pathname)) {
      if (!sendLogin) return json(res, 503, { error: 'El acceso por correo aún no está disponible.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Formato no permitido.' });
      let body;
      try { body = await jsonBody(req, 2048); } catch { return json(res, 400, { error: 'Solicitud no válida.' }); }
      if (pathname === '/api/auth/email') {
        const email = normalizeEmail(body?.email);
        if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && emailRequestsAllowed(req.socket.remoteAddress)) {
          const link = store.issueEmail(email);
          if (link) void sendLogin(email, config.origin + '/#acceso-email=' + link).catch(() => {
            store.discardEmail(link);
            console.warn('No se pudo entregar un enlace de acceso por correo.');
          });
        }
        return json(res, 202, { ok: true });
      }
      const link = body?.token;
      const newToken = typeof link === 'string' && /^[A-Za-z0-9_-]{43}$/.test(link) && store.useEmail(link, sessionAge);
      if (!newToken) return json(res, 400, { error: 'El enlace ya no es válido. Solicita uno nuevo.' });
      store.signOut(token);
      res.setHeader('Set-Cookie', escapeCookie(sessionCookie, newToken, sessionAge, config.secure));
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      store.signOut(token);
      res.setHeader('Set-Cookie', escapeCookie(sessionCookie, '', 0, config.secure));
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/state' && req.method === 'POST') {
      if (!store.read(token)) return json(res, 401, { error: 'Tu acceso ya no está disponible. Vuelve a iniciar sesión.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Formato no permitido.' });
      try {
        const payload = await jsonBody(req);
        const result = store.write(token, payload.data, payload.revision);
        if (result.status === 200) return json(res, 200, result);
        return json(res, result.status, { error: result.status === 409
          ? 'Los datos cambiaron en otra sesión. Vuelve a cargar antes de continuar.'
          : 'Tu acceso ya no está disponible. Vuelve a iniciar sesión.' });
      } catch (error) {
        return json(res, 400, { error: error.constructor === Error ? error.message : 'No se pudo guardar el registro.' });
      }
    }
    return json(res, 404, { error: 'Ruta no encontrada.' });
  };
}
