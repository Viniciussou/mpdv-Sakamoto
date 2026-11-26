// Build para Vercel/Netlify: copia o site para dist/ e gera dist/assets/js/config.js
// a partir das variáveis de ambiente (integração Supabase da Vercel ou definidas à mão).
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

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
console.log('[build] OK ->', url.replace(/\/$/, ''), '| chave pública:', key.slice(0, 12) + '…');
