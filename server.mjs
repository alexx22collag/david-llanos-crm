import http from 'node:http';
import {readFile} from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { oauthConfig } from './auth.mjs';
import { accountStore } from './account-store.mjs';
import { authApi } from './auth-api.mjs';
import { resendLoginMailer } from './login-mail.mjs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const config = oauthConfig(process.env);
const requestedDb = process.env.CRM_DB_PATH || '.local/workspace.sqlite';
const dbPath = requestedDb === ':memory:' ? requestedDb : path.resolve(requestedDb);
if (config && dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
const api = authApi(config, config ? accountStore(dbPath, config.adminEmail) : null, { sendLogin: resendLoginMailer(process.env) });
const root = path.resolve('dist');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    const data = await readFile(file);
    return res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}).end(data);
  } catch {
    return res.writeHead(404).end('No encontrado');
  }
}).listen(Number(process.env.PORT || 4174), process.env.CRM_BIND || '127.0.0.1', () =>
  console.log('CRM en modo ' + (config ? 'Google' : 'demo') + ' · ' + (config?.origin || 'http://127.0.0.1:' + (process.env.PORT || 4174))));
