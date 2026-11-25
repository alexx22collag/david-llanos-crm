import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { oauthConfig } from './auth.mjs';

try {
  const [file] = process.argv.slice(2);
  if (!file) throw Error('Indica la ruta del JSON descargado desde Google Cloud.');
  const destination = '.env.local';
  const previous = existsSync(destination) ? parseEnv(readFileSync(destination, 'utf8')) : {};
  const { web } = JSON.parse(readFileSync(file === '--stdin' ? 0 : file, 'utf8'));
  if (!web?.client_id || !web.client_secret) throw Error('El JSON debe pertenecer a un cliente OAuth de tipo Aplicación web.');
  const next = { ...previous, CRM_MODE: 'google', GOOGLE_CLIENT_ID: web.client_id, GOOGLE_CLIENT_SECRET: web.client_secret };
  const config = oauthConfig(next);
  if (!web.redirect_uris?.includes(config.redirect)) throw Error('Añade la URI exacta de retorno en Google Cloud: ' + config.redirect);
  writeFileSync(destination, Object.entries(next).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 });
  console.log('Configuración local guardada. Reinicia el servidor para activar Google.');
} catch (error) {
  console.error(error instanceof SyntaxError ? 'No se pudo leer el JSON de Google Cloud.' : error.message);
  process.exitCode = 1;
}
