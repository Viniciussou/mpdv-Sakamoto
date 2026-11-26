// Gera a configuração pública do Supabase durante o build da Vercel.
// Somente URL e publishable key são disponibilizadas ao navegador.
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('\n[MPDV] Variáveis ausentes. Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY na Vercel.');
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
  console.error('[MPDV] SUPABASE_URL inválida. Use a Project URL fornecida pelo Supabase.');
  process.exit(1);
}

if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ')) {
  console.error('[MPDV] A chave deve ser uma publishable key (sb_publishable_) ou anon key legada. Nunca use secret/service_role.');
  process.exit(1);
}

const target = path.join(__dirname, '..', 'assets', 'js', 'runtime-config.js');
const content = `// Gerado automaticamente no build. Não editar manualmente.\nexport const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_KEY = ${JSON.stringify(key)};\n`;
fs.writeFileSync(target, content, 'utf8');
console.log('[MPDV] Configuração pública do Supabase gerada com sucesso.');
