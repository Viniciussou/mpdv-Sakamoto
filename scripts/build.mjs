// Build para Vercel/Netlify: copia o site para dist/ e gera dist/assets/js/config.js
// a partir das variáveis de ambiente (integração Supabase da Vercel ou definidas à mão).
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const env = process.env;
const pick = (...names) => names.map((n) => env[n]).find((v) => v && v.trim())?.trim();
let url = pick('MPDV_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
let key = pick('MPDV_SUPABASE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');

if (!url || !key) {
  console.error('[build] ABORTADO: variáveis do Supabase não encontradas.\n'
    + '  Na Vercel: Storage/Integrations > Supabase (injeta NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY),\n'
    + '  ou crie MPDV_SUPABASE_URL e MPDV_SUPABASE_KEY em Settings > Environment Variables e faça Redeploy.');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url || '')) { console.error('[build] SUPABASE_URL inválida:', url); process.exit(1); }

// Trava de segurança: nunca publicar chave secreta no navegador.
function isSecret(k) {
  if (/^sb_secret_/.test(k)) return true;
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { return false; }
}
if (!key || isSecret(key)) { console.error('[build] ABORTADO: a chave informada é secreta (service_role) ou está vazia. Use a chave pública (anon/publishable).'); process.exit(1); }

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('index.html', 'dist/index.html');
cpSync('assets', 'dist/assets', { recursive: true });
writeFileSync('dist/assets/js/config.js',
`// GERADO NO BUILD a partir de variáveis de ambiente. Somente chave pública.
export const SUPABASE_URL = ${JSON.stringify(url.replace(/\/$/, ''))};
export const SUPABASE_KEY = ${JSON.stringify(key)};
export const POLL_MS = 30000;
`);

// CSP gerada da MESMA URL do config.js: impossível divergir. Só este projeto Supabase é permitido.
const origin = new URL(url).origin;
const wss = origin.replace(/^https:/, 'wss:');
const csp = [`default-src 'self'`, `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${origin}`, `connect-src 'self' ${origin} ${wss}`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`].join('; ');
let page = readFileSync('dist/index.html', 'utf8');
if (!page.includes('<!--MPDV_CSP-->')) { console.error('[build] index.html sem o marcador <!--MPDV_CSP-->'); process.exit(1); }
page = page.replace('<!--MPDV_CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
writeFileSync('dist/index.html', page);

// Verificação final: um único projeto Supabase em todo o dist.
const hosts = new Set();
for (const f of ['dist/index.html', 'dist/assets/js/config.js']) for (const m of readFileSync(f, 'utf8').matchAll(/[a-z0-9-]+\.supabase\.(?:co|in)/gi)) hosts.add(m[0].toLowerCase());
if (hosts.size !== 1 || ![...hosts][0] || new URL(url).host.toLowerCase() !== [...hosts][0]) { console.error('[build] ABORTADO: URLs do Supabase inconsistentes no dist:', [...hosts]); process.exit(1); }
console.log('[build] OK ->', url.replace(/\/$/, ''), '| chave pública:', key.slice(0, 12) + '…');
