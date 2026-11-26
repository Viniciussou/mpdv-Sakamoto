// Configuração pública carregada do arquivo gerado a partir das variáveis da Vercel.
// A publishable key é própria para o navegador; nunca use SUPABASE_SECRET_KEY aqui.
import { SUPABASE_URL, SUPABASE_KEY } from './runtime-config.js';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Supabase não configurado. Confira SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY nas variáveis da Vercel e faça um novo deploy.');
}

export { SUPABASE_URL, SUPABASE_KEY };
export const POLL_MS = 30000;
