// Função de servidor (Vercel) para o Marketing gerenciar vendedores.
// Usa a chave SECRETA (service_role) que existe apenas no servidor (variável de ambiente da Vercel).
// Segurança: só atende quem tem sessão válida E perfil Marketing ativo; só mexe em contas de VENDEDOR.
const env = process.env;
const pick = (...n) => n.map((k) => env[k]).find((v) => v && v.trim())?.trim();
const cfg = () => ({
  url: pick('MPDV_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')?.replace(/\/$/, ''),
  key: pick('MPDV_SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const out = (res, code, body) => res.status(code).json(body);
class Falha extends Error { constructor(code, erro, codigo) { super(erro); this.code = code; this.erro = erro; this.codigo = codigo; } }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return out(res, 405, { erro: 'Método não permitido.' }); }
  const { url, key } = cfg();
  if (!url || !key) return out(res, 500, { erro: 'Servidor sem a variável SUPABASE_SERVICE_ROLE_KEY. Configure-a na Vercel e faça Redeploy.', codigo: 'CONFIG' });

  const H = { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const rest = async (path, opts = {}) => fetch(`${url}/rest/v1${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const admin = async (path, method, body) => {
    const r = await fetch(`${url}/auth/v1/admin${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) {
      const c = j?.error_code || j?.code || '';
      if (/email_exists|user_already_exists|email_address_already/i.test(String(c)) || /already (been )?registered|already exists/i.test(j?.msg || j?.message || '')) throw new Falha(409, 'Já existe um usuário com este e-mail.', 'EMAIL_EXISTE');
      if (/weak_password/i.test(String(c))) throw new Falha(400, 'Senha fraca. Use ao menos 8 caracteres, misturando letras e números.', 'SENHA_FRACA');
      throw new Falha(502, 'O Supabase recusou a operação.', 'AUTH_ADMIN');
    }
    return j;
  };

  try {
    // 1) quem está chamando? (o GoTrue valida assinatura e validade do token)
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new Falha(401, 'Sessão ausente. Entre novamente.', 'NAO_AUTENTICADO');
    const ru = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!ru.ok) throw new Falha(401, 'Sessão inválida ou expirada. Entre novamente.', 'NAO_AUTENTICADO');
    const caller = await ru.json();
    if (!caller?.id || !UUID.test(caller.id)) throw new Falha(401, 'Sessão inválida.', 'NAO_AUTENTICADO');

    // 2) é Marketing ativo?
    const rp = await rest(`/perfis_mpdv?id=eq.${caller.id}&select=papel,ativo`);
    const pf = rp.ok ? (await rp.json())[0] : null;
    if (!pf || pf.papel !== 'marketing' || !pf.ativo) throw new Falha(403, 'Acesso restrito ao Marketing.', 'SEM_PERMISSAO');

    // 3) entrada
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    if (!b || typeof b !== 'object') throw new Falha(400, 'Requisição inválida.', 'ENTRADA');
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const senha = typeof b.senha === 'string' ? b.senha : '';
    const nome = typeof b.nome === 'string' ? b.nome.trim().slice(0, 120) : '';
    const validaSenha = () => { if (senha.length < 8 || senha.length > 72) throw new Falha(400, 'A senha deve ter entre 8 e 72 caracteres.', 'SENHA_FRACA'); };
    const validaEmail = () => { if (!EMAIL.test(email) || email.length > 254) throw new Falha(400, 'Informe um e-mail válido.', 'EMAIL_INVALIDO'); };
    const alvoVendedor = async () => {
      if (typeof b.id !== 'string' || !UUID.test(b.id)) throw new Falha(400, 'Usuário inválido.', 'ENTRADA');
      const r = await rest(`/perfis_mpdv?id=eq.${b.id}&select=id,papel`);
      const p = r.ok ? (await r.json())[0] : null;
      if (!p) throw new Falha(404, 'Usuário não encontrado.', 'NAO_ENCONTRADO');
      if (p.papel !== 'vendedor') throw new Falha(403, 'Só é possível alterar contas de vendedores.', 'SEM_PERMISSAO');
      return p;
    };
    const auditar = (acao, registro, depois) => rest('/auditoria_mpdv', { method: 'POST', body: JSON.stringify({ tabela: 'auth.users', registro_id: registro, acao, usuario_id: caller.id, depois }) }).catch(() => {});

    // 4) ações
    if (b.action === 'criar') {
      validaEmail(); validaSenha();
      if (!nome) throw new Falha(400, 'Informe o nome do vendedor.', 'ENTRADA');
      const u = await admin('/users', 'POST', { email, password: senha, email_confirm: true, user_metadata: { nome } });
      await auditar('CRIAR_VENDEDOR', u.id, { email, nome });
      const rv = await rest(`/perfis_mpdv?id=eq.${u.id}&select=papel`);
      const perfil = rv.ok ? (await rv.json())[0] : null;
      if (perfil?.papel !== 'vendedor') throw new Falha(500, 'Usuário criado, mas o perfil de vendedor não foi gerado. Confirme que a migração (02_migracao.sql) foi executada.', 'PERFIL');
      return out(res, 200, { ok: true, id: u.id, email, nome });
    }
    if (b.action === 'senha') {
      validaSenha(); await alvoVendedor();
      await admin(`/users/${b.id}`, 'PUT', { password: senha });
      await auditar('REDEFINIR_SENHA', b.id, {});
      return out(res, 200, { ok: true });
    }
    if (b.action === 'email') {
      validaEmail(); await alvoVendedor();
      await admin(`/users/${b.id}`, 'PUT', { email, email_confirm: true });
      await auditar('ALTERAR_EMAIL', b.id, { email });
      return out(res, 200, { ok: true });
    }
    throw new Falha(400, 'Ação desconhecida.', 'ENTRADA');
  } catch (e) {
    if (e instanceof Falha) return out(res, e.code, { erro: e.erro, codigo: e.codigo });
    return out(res, 500, { erro: 'Erro inesperado no servidor.', codigo: 'INTERNO' });
  }
}
