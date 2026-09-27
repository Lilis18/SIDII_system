const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const envPath = path.join(frontendRoot, '.env');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const envValue = envText.match(/^\s*VITE_BACKEND_URL\s*=\s*(.*?)\s*$/m)?.[1];
const configuredUrl = process.env.VITE_BACKEND_URL || envValue?.replace(/^(["'])(.*)\1$/, '$2');

if (!configuredUrl) {
  throw new Error('Define VITE_BACKEND_URL en frontend/.env o en las variables de entorno del despliegue.');
}

const apiUrl = new URL(configuredUrl);
if (!['http:', 'https:'].includes(apiUrl.protocol)) {
  throw new Error('VITE_BACKEND_URL debe usar HTTP o HTTPS.');
}
if (!apiUrl.pathname.replace(/\/+$/, '').endsWith('/api')) {
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, '')}/api`;
}
apiUrl.pathname = apiUrl.pathname.replace(/\/+$/, '');

const output = `window.SIDII_API_BASE = ${JSON.stringify(apiUrl.toString().replace(/\/$/, ''))};\n`;
fs.writeFileSync(path.join(frontendRoot, 'js', 'api-config.js'), output);
console.log('Configuración de API generada en js/api-config.js');