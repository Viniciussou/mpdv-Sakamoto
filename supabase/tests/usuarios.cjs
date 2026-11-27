// E2E da tela de gerenciamento de vendedores (Marketing) + segurança da função /api/usuarios
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs');
const BASE = 'http://localhost:8080', OUT = process.env.SHOTS || '/home/claude/test/shots', SUPA = process.env.SUPA_JS || '/home/claude/test/npm/node_modules/@supabase/supabase-js/dist/umd/supabase.js';
fs.mkdirSync(OUT, { recursive: true });
const psql = (q) => execSync(`psql -X -q -t -A -h /tmp -p 5544 -U postgres -d t -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const R = []; const check = (n, ok, i = '') => { R.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && i ? ' -> ' + i : ''}`); };
const errors = [];
async function mk(b, o = {}) { const c = await b.newContext({ viewport: { width: 1366, height: 820 }, locale: 'pt-BR', ...o }); await c.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(SUPA) })); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_CONNECTION|Failed to load resource/i.test(m.text())) errors.push(m.text()); }); return { c, p }; }
const login = async (p, e, pw = 'senha123') => { await p.goto(BASE + '/'); await p.fill('#email', e); await p.fill('#pw', pw); await p.click('#lbtn'); };
const shot = async (p, n) => { await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/${n}.png` }); };
(async () => {
  psql(`delete from auth.users where email like '%@teste.com'`);
  const b = await chromium.launch(); const { c, p } = await mk(b);
  await login(p, 'marketing@x.com'); await p.waitForSelector('.kpis'); await p.click('.sidebar a[href="#/admin/vendedores"]'); await p.waitForSelector('#novo');
  await shot(p, '30-vendedores-lista');
  await p.click('#novo'); await p.waitForSelector('#v-nome');
  const gen = await p.inputValue('#v-senha');
  check('Modal "Novo vendedor" já sugere senha segura gerada (12 caracteres)', gen.length === 12 && /^[A-Za-z2-9]+$/.test(gen), gen);
  await p.fill('#v-nome', 'Paulo Teste'); await p.fill('#v-email', 'Paulo@Teste.com'); await shot(p, '31-novo-vendedor-modal');
  await p.fill('#v-senha', '123'); await p.click('#v-save');
  check('Senha curta é barrada com mensagem', (await p.textContent('#v-err')).includes('8 caracteres'));
  await p.fill('#v-senha', 'Senha@2026'); await p.click('#v-save'); await p.waitForSelector('.alert.success');
  check('Criação mostra e-mail e senha para copiar', (await p.textContent('.modal')).includes('paulo@teste.com') && (await p.textContent('.modal')).includes('Senha@2026') && (await p.textContent('.modal')).includes('não será mostrada novamente'));
  await shot(p, '32-vendedor-criado');
  check('Vendedor criado no banco como "vendedor" ativo com o nome informado', psql(`select papel||'|'||ativo||'|'||nome from public.perfis_mpdv where email='paulo@teste.com'`) === 'vendedor|true|Paulo Teste');
  await p.click('.modal [data-close]'); await p.waitForSelector('tr:has-text("Paulo Teste")');
  check('Novo vendedor aparece na lista', true);
  // duplicado
  await p.click('#novo'); await p.fill('#v-nome', 'Outro'); await p.fill('#v-email', 'paulo@teste.com'); await p.click('#v-save');
  await p.waitForSelector('#v-err:not(.hidden)'); check('E-mail duplicado mostra erro amigável', (await p.textContent('#v-err')).includes('Já existe'));
  await p.click('.modal [data-close]');
  // login do novo vendedor (outro contexto)
  { const v = await mk(b); await login(v.p, 'paulo@teste.com', 'Senha@2026'); await v.p.waitForSelector('article.product');
    check('O novo vendedor consegue entrar e cai na loja (sem painel admin)', v.p.url().endsWith('#/loja') && await v.p.locator('.sidebar').count() === 0);
    // token do vendedor não pode usar a função
    const r = await v.p.evaluate(async () => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); const t = JSON.parse(localStorage.getItem(k)).access_token;
      const f = await fetch('/api/usuarios', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ action: 'criar', email: 'hack@teste.com', senha: '12345678', nome: 'H' }) }); return f.status; });
    check('Vendedor chamando /api/usuarios diretamente recebe 403', r === 403, r);
    check('...e nada foi criado', psql(`select count(*) from auth.users where email='hack@teste.com'`) === '0');
    await v.c.close(); }
  // redefinir senha
  await p.click('tr:has-text("Paulo Teste")'); await p.waitForSelector('[data-pass]'); await shot(p, '33-vendedor-drawer');
  await p.click('[data-pass]'); await p.waitForSelector('#s-senha'); await p.fill('#s-senha', 'NovaSenha#77'); await p.click('#s-save'); await p.waitForSelector('.alert.success');
  check('Redefinição exibe a nova senha para repassar', (await p.textContent('.modal')).includes('NovaSenha#77'));
  await p.click('.modal [data-close]');
  { const v = await mk(b); await login(v.p, 'paulo@teste.com', 'Senha@2026'); await v.p.waitForSelector('#lerr:not(.hidden)');
    check('Senha antiga deixa de funcionar', (await v.p.textContent('#lerr')).includes('incorretos'));
    await v.p.fill('#pw', 'NovaSenha#77'); await v.p.click('#lbtn'); await v.p.waitForSelector('article.product'); check('Senha nova funciona', true); await v.c.close(); }
  // editar dados
  await p.waitForSelector('.drawer', { state: 'detached' }).catch(() => {}); 
  if (await p.locator('.drawer').count()) await p.keyboard.press('Escape');
  await p.click('tr:has-text("Paulo Teste")'); await p.click('[data-edit]'); await p.waitForSelector('#v-nome');
  await p.fill('#v-nome', 'Paulo Renomeado'); await p.fill('#v-email', 'paulo.novo@teste.com'); await p.click('#v-save'); await p.waitForSelector('tr:has-text("Paulo Renomeado")');
  check('Edição altera nome e e-mail de acesso', psql(`select nome||'|'||email from public.perfis_mpdv where nome='Paulo Renomeado'`) === 'Paulo Renomeado|paulo.novo@teste.com');
  { const v = await mk(b); await login(v.p, 'paulo.novo@teste.com', 'NovaSenha#77'); await v.p.waitForSelector('article.product'); check('Login funciona com o novo e-mail', true); await v.c.close(); }
  check('Ações registradas na auditoria (criar, senha, e-mail)', Number(psql(`select count(*) from public.auditoria_mpdv where tabela='auth.users'`)) >= 3);
  // marketing desativado não pode usar a função
  const tk = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); return JSON.parse(localStorage.getItem(k)).access_token; });
  psql(`update public.perfis_mpdv set ativo=false where email='marketing@x.com'`);
  const st = await p.evaluate(async (t) => (await fetch('/api/usuarios', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ action: 'criar', email: 'inativo@teste.com', senha: '12345678', nome: 'I' }) })).status, tk);
  psql(`update public.perfis_mpdv set ativo=true where email='marketing@x.com'`);
  check('Marketing DESATIVADO também é barrado pela função (403)', st === 403, st);
  await c.close();
  // mobile
  { const m = await mk(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await login(m.p, 'marketing@x.com'); await m.p.waitForSelector('.kpis'); await m.p.goto(BASE + '/#/admin/vendedores'); await m.p.waitForSelector('#novo'); await shot(m.p, '34-mobile-vendedores');
    await m.p.click('#novo'); await m.p.waitForSelector('#v-senha'); await shot(m.p, '35-mobile-novo-vendedor');
    check('Mobile: modal sem rolagem horizontal', !(await m.p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))); await m.c.close(); }
  check('Sem erros de JavaScript', errors.length === 0, errors.join('|'));
  await b.close(); console.log(`\nRESULTADO USUÁRIOS: ${R.filter(Boolean).length}/${R.length}`); process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
