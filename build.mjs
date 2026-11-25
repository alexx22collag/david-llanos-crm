import {readFileSync} from 'node:fs';
const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
const files = ['index.html', 'privacidad.html', 'terminos.html', 'app.js', 'styles.css', 'dashboard.css', 'model.js', 'agenda.js', 'coach.js', 'david-llanos-lockup.jpg', 'login-bg.jpg', 'google-g.png', 'favicon-32.png', 'sw.js', 'icon-180.png', ...manifest.icons.map(icon => icon.src)];
for (const file of files) {
  if (!readFileSync(`dist/${file}`).length) throw new Error(`Archivo vacío: ${file}`);
}
console.log('Build estático verificado: dist/');
