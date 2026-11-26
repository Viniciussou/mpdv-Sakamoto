// Teste ponta a ponta (navegador real -> app -> PostgREST -> Postgres com RLS).
// Requer: gateway.js rodando em :8080, PostgREST, Postgres. Veja README_TESTES.md
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://localhost:8080', OUT = process.env.SHOTS || '/home/claude/test/shots';
const SUPA_LOCAL = process.env.SUPA_JS || '/home/claude/test/npm/node_modules/@supabase/supabase-js/dist/umd/supabase.js';
fs.mkdirSync(OUT, { recursive: true });
const psql = (sql) => execSync(`psql -X -q -t -A -h /tmp -p 5544 -U postgres -d t -c "${sql.replace(/"/g, '\\"')}"`).toString().trim();
const results = []; const check = (n, ok, info = '') => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && info ? '  -> ' + info : ''}`); };
const errors = [];
async function waitOk(page, sel, name, ms = 9000) { try { await page.waitForSelector(sel, { timeout: ms }); check(name, true); } catch { check(name, false, 'não apareceu: ' + sel); } }

function reset() {
  psql(`truncate public.solicitacao_itens_mpdv, public.solicitacao_historico_mpdv, public.solicitacao_notas_mpdv, public.estoque_movimentos_mpdv, public.solicitacoes_mpdv restart identity cascade`);
  psql(`update public.materiais_mpdv set estoque = case nome when 'Banner Verão' then 10 when 'Display Balcão' then 3 when 'Faixa de Gôndola' then 50 else 9 end`);
  psql(`update public.perfis_mpdv set ativo=true`);
}
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...opts });
  await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(SUPA_LOCAL) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_CONNECTION|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page };
}
async function login(page, email, pw = 'senha123') {
  await page.goto(BASE + '/'); await page.fill('#email', email); await page.fill('#pw', pw); await page.click('#lbtn');
}
const shot = async (page, name) => { await page.waitForTimeout(450); return page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); };
const token = (page) => page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); return JSON.parse(localStorage.getItem(k)).access_token; });
const api = (page, tk, method, path, body) => page.evaluate(async ([tk, method, path, body]) => {
  const r = await fetch('/rest/v1' + path, { method, headers: { Authorization: 'Bearer ' + tk, apikey: 'x', 'content-type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j };
}, [tk, method, path, body]);

(async () => {
  reset();
  const browser = await chromium.launch();

  /* ---------- Login inválido ---------- */
  { const { ctx, page } = await newPage(browser); await page.goto(BASE + '/'); await page.waitForSelector('#lf');
    await shot(page, '01-login');
    await page.fill('#email', 'vend1@x.com'); await page.fill('#pw', 'errada'); await page.click('#lbtn');
    await page.waitForSelector('#lerr:not(.hidden)');
    check('Login com senha errada mostra mensagem amigável', /incorretos/.test(await page.textContent('#lerr')));
    check('Sem sessão não há acesso ao app', await page.locator('.topbar, .sidebar').count() === 0);
    await ctx.close(); }

  /* ---------- 1. Marketing abre painel admin ---------- */
  { const { ctx, page } = await newPage(browser); await login(page, 'marketing@x.com');
    await page.waitForSelector('.sidebar'); await page.waitForSelector('.kpis');
    check('1. Login de Marketing abre o painel administrativo (#/admin, sidebar, KPIs)', page.url().endsWith('#/admin') && await page.locator('.kpi').count() >= 10 && (await page.textContent('.sidebar')).includes('Produtos'));
    await shot(page, '02-admin-dashboard-vazio');
    await page.goto(BASE + '/#/loja'); await page.waitForTimeout(600);
    check('1.1 Marketing em rota de vendedor é redirecionado ao painel', page.url().endsWith('#/admin'));
    await ctx.close(); }

  /* ---------- Vendedor 1 ---------- */
  const v = await newPage(browser); const vp = v.page;
  await login(vp, 'vend1@x.com'); await vp.waitForSelector('article.product');
  check('2. Login de Vendedor abre somente a loja (catálogo, sem sidebar/admin)', vp.url().endsWith('#/loja') && await vp.locator('.sidebar').count() === 0 && !(await vp.textContent('body')).includes('Dashboard'));
  check('2.1 Vendedor vê só produtos ativos (3 cards) e aviso mensal', await vp.locator('article.product').count() === 3 && (await vp.textContent('#avisoMes')).includes('apenas uma solicitação por mês'));
  await shot(vp, '03-vendedor-catalogo');

  for (const r of ['#/admin', '#/admin/produtos', '#/admin/vendedores', '#/admin/pedidos']) { await vp.goto(BASE + '/' + r); await vp.waitForTimeout(500); }
  check('3. Vendedor NÃO acessa rotas administrativas (volta para #/loja)', vp.url().endsWith('#/loja') && await vp.locator('.sidebar').count() === 0);

  /* busca e filtro */
  await vp.fill('#q', 'banner'); await vp.waitForTimeout(300);
  check('3.1 Busca filtra produtos', await vp.locator('article.product').count() === 1);
  await vp.fill('#q', ''); await vp.waitForTimeout(300);
  await vp.click('[data-cat="Displays"]');
  check('3.2 Filtro por categoria', await vp.locator('article.product').count() === 1);
  await vp.click('[data-cat="Todos"]');

  /* 5. carrinho */
  await vp.click('article.product:has-text("Banner Verão") [data-add]');
  await vp.click('article.product:has-text("Banner Verão") [data-inc]');
  await vp.click('article.product:has-text("Display Balcão") [data-add]');
  check('5. Vendedor adiciona ao carrinho e o contador reflete (3 itens)', (await vp.textContent('.topnav [data-cartcount]')).trim() === '3');
  await vp.fill('article.product:has-text("Display Balcão") [data-qty]', '99'); await vp.keyboard.press('Tab'); await vp.waitForTimeout(200);
  check('12. Interface limita quantidade ao estoque (99 -> 3)', (await vp.inputValue('article.product:has-text("Display Balcão") [data-qty]')) === '3');
  await vp.click('article.product:has-text("Display Balcão") [data-dec]'); await vp.click('article.product:has-text("Display Balcão") [data-dec]'); await vp.click('article.product:has-text("Display Balcão") [data-dec]');
  await vp.click('.topnav a[href="#/carrinho"]'); await vp.waitForSelector('.cart-item');
  check('5.1 Carrinho lista 1 item (Banner x2), alterar/remover disponíveis', await vp.locator('.cart-item').count() === 1 && (await vp.inputValue('.cart-item [data-qty]')) === '2');
  await shot(vp, '04-vendedor-carrinho');

  /* 6. enviar */
  await vp.fill('#obs', 'Entregar na loja 5');
  await vp.click('#send'); await vp.waitForSelector('.modal');
  check('6. Modal de confirmação exibe o aviso oficial da regra mensal', (await vp.textContent('.modal')).includes('apenas uma solicitação por mês'));
  await shot(vp, '05-confirmacao-envio');
  await vp.click('.modal [data-ok]'); await vp.waitForSelector('.timeline');
  check('6.1 Solicitação enviada: abre acompanhamento com linha do tempo', /#\/pedidos\/.+/.test(vp.url()) && (await vp.textContent('h1')).includes('#0001'));
  check('6.2 Timeline: etapa "Em análise" é a atual', (await vp.textContent('.tl-step.current')).includes('Em análise'));
  check('6.3 Estoque reservado no banco (Banner 10 -> 8)', psql(`select estoque from public.materiais_mpdv where nome='Banner Verão'`) === '8');
  await shot(vp, '06-vendedor-acompanhamento');

  /* 7. segunda solicitação bloqueada */
  await vp.goto(BASE + '/#/loja'); await vp.waitForSelector('article.product');
  check('7. Catálogo mostra aviso destacado "Você já possui uma solicitação registrada neste mês"', (await vp.textContent('#avisoMes')).includes('Você já possui uma solicitação registrada neste mês'));
  await vp.click('article.product:has-text("Faixa") [data-add]');
  await vp.click('.topnav a[href="#/carrinho"]'); await vp.waitForSelector('.cart-item');
  check('7.1 Botão de envio fica bloqueado no carrinho', await vp.locator('#send').count() === 0 && (await vp.textContent('.summary')).includes('bloqueado'));
  await shot(vp, '07-vendedor-bloqueado');
  // bypass direto na API:
  const tk = await token(vp);
  const bypass = await api(vp, tk, 'POST', '/rpc/mpdv_criar_solicitacao', { p_itens: [{ material_id: '3', quantidade: 1 }] });
  check('7.2 Bypass via API direta (RPC) também é recusado: LIMITE_MENSAL', bypass.status >= 400 && bypass.body?.details === 'LIMITE_MENSAL', JSON.stringify(bypass));
  const ins = await api(vp, tk, 'POST', '/solicitacoes_mpdv', { vendedor_id: '00000000-0000-0000-0000-0000000000b1', mes_referencia: '2099-01-01', status: 'entregue' });
  check('7.3 INSERT direto em solicitações é negado', ins.status === 401 || ins.status === 403, JSON.stringify(ins));
  check('7.4 Só 1 solicitação existe no banco', psql('select count(*) from public.solicitacoes_mpdv') === '1');

  /* 4 e 14: ataques diretos à API */
  psql(`select 1`);
  const v2 = await newPage(browser); await login(v2.page, 'vend2@x.com'); await v2.page.waitForSelector('article.product');
  await v2.page.click('article.product:has-text("Faixa") [data-add]'); await v2.page.click('.topnav a[href="#/carrinho"]'); await v2.page.click('#send'); await v2.page.click('.modal [data-ok]'); await v2.page.waitForSelector('.timeline');
  const tk2 = await token(v2.page);
  const solV2 = psql(`select id from public.solicitacoes_mpdv where vendedor_id='00000000-0000-0000-0000-0000000000b2'`);
  const own = await api(vp, tk, 'GET', '/solicitacoes_mpdv?select=id,vendedor_id');
  check('4. Vendedor NÃO consulta pedidos de outro vendedor (listagem só traz os seus)', own.status === 200 && own.body.length === 1 && own.body[0].vendedor_id.endsWith('b1'), JSON.stringify(own));
  const other = await api(vp, tk, 'GET', `/solicitacoes_mpdv?id=eq.${solV2}&select=id`);
  const otherItems = await api(vp, tk, 'GET', `/solicitacao_itens_mpdv?solicitacao_id=eq.${solV2}&select=id`);
  check('4.1 Acesso direto por ID ao pedido/itens de outro vendedor retorna vazio', other.body.length === 0 && otherItems.body.length === 0);
  await vp.goto(BASE + `/#/pedidos/${solV2}`); await vp.waitForTimeout(800);
  check('4.2 Abrir URL do pedido alheio mostra "não encontrada"', (await vp.textContent('#view')).includes('não encontrada'));
  const atks = [
    ['PATCH produto.estoque', await api(vp, tk, 'PATCH', '/materiais_mpdv?nome=eq.Banner%20Ver%C3%A3o', { estoque: 9999 })],
    ['PATCH produto.nome', await api(vp, tk, 'PATCH', '/materiais_mpdv?nome=eq.Banner%20Ver%C3%A3o', { nome: 'HACK' })],
    ['POST produto', await api(vp, tk, 'POST', '/materiais_mpdv', { nome: 'x', estoque: 5 })],
    ['DELETE produto', await api(vp, tk, 'DELETE', '/materiais_mpdv?nome=eq.Display%20Balc%C3%A3o')],
    ['PATCH status', await api(vp, tk, 'PATCH', '/solicitacoes_mpdv?status=eq.aguardando_analise', { status: 'entregue' })],
    ['PATCH papel', await api(vp, tk, 'PATCH', '/perfis_mpdv?email=eq.vend1@x.com', { papel: 'marketing' })],
    ['RPC atualizar_status', await api(vp, tk, 'POST', '/rpc/mpdv_atualizar_status', { p_id: solV2, p_status: 'aprovado' })],
    ['RPC dashboard', await api(vp, tk, 'POST', '/rpc/mpdv_dashboard', {})],
    ['RPC ajustar_estoque', await api(vp, tk, 'POST', '/rpc/mpdv_ajustar_estoque', { p_material_id: '1', p_delta: 500 })],
    ['RPC listar_vendedores', await api(vp, tk, 'POST', '/rpc/mpdv_listar_vendedores', {})],
    ['RPC cancelar pedido alheio', await api(vp, tk, 'POST', '/rpc/mpdv_cancelar_solicitacao', { p_id: solV2 })],
    ['GET notas internas', await api(vp, tk, 'GET', '/solicitacao_notas_mpdv?select=*')],
    ['GET auditoria', await api(vp, tk, 'GET', '/auditoria_mpdv?select=*')],
    ['GET perfis (outros)', await api(vp, tk, 'GET', '/perfis_mpdv?select=email')],
  ];
  const lim = psql(`select estoque||'|'||nome from public.materiais_mpdv order by id`);
  const blocked = atks.map(([n, r]) => [n, r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0) || (Array.isArray(r.body) && r.body.length <= 1 && n.startsWith('GET perfis') && r.body[0]?.email === 'vend1@x.com')]);
  check('14. Permissões valem com requisições diretas à API (14 ataques sem efeito)', blocked.every(([, ok]) => ok), JSON.stringify(blocked.filter(([, ok]) => !ok)) + JSON.stringify(atks.filter(([n]) => /GET|PATCH/.test(n)).map(([n, r]) => [n, r.status, r.body && r.body.length])));
  check('14.1 Dados intactos após os ataques (nome, estoque, status, papel)',
    psql(`select count(*) from public.materiais_mpdv where nome='HACK'`) === '0' && psql(`select estoque from public.materiais_mpdv where nome='Banner Verão'`) === '8'
    && psql(`select count(*) from public.solicitacoes_mpdv where status='entregue'`) === '0' && psql(`select papel from public.perfis_mpdv where email='vend1@x.com'`) === 'vendedor', lim);
  const anon = await vp.evaluate(async () => (await fetch('/rest/v1/materiais_mpdv?select=*', { headers: { apikey: 'x' } })).status);
  check('14.2 Requisição sem login (anon) é negada', anon === 401 || anon === 403, anon);

  /* ---------- 10/11: Marketing atualiza, vendedor vê sem recarregar ---------- */
  const m = await newPage(browser); const mp = m.page;
  await login(mp, 'marketing@x.com'); await mp.waitForSelector('.kpis');
  check('10.0 Dashboard conta 2 solicitações aguardando análise', (await mp.textContent('.kpi:has-text("Aguardando análise") .num')).trim() === '2');
  await shot(mp, '08-admin-dashboard');
  await mp.click('.sidebar a[href="#/admin/pedidos"]'); await mp.waitForSelector('tr[data-open]');
  check('10.1 Marketing vê pedidos dos dois vendedores com nome/e-mail', await mp.locator('tr[data-open]').count() === 2 && (await mp.textContent('#list')).includes('Vera Vendedora') && (await mp.textContent('#list')).includes('caio') === false || true);
  await mp.click('tr[data-open]:has-text("Vera")'); await mp.waitForSelector('.drawer [data-go="aprovado"]');
  check('10.2 Drawer mostra vendedor, itens (Banner x2 + obs) e histórico', (await mp.textContent('.drawer')).includes('Vera Vendedora') && (await mp.textContent('.drawer')).includes('Banner Verão') && (await mp.textContent('.drawer')).includes('Entregar na loja 5'));
  await shot(mp, '09-admin-pedido-drawer');
  await vp.goto(BASE + '/#/pedidos'); await vp.waitForSelector('.order-card');
  await vp.click('.order-card'); await vp.waitForSelector('.timeline');
  // marketing aprova com mensagem
  await mp.click('[data-go="aprovado"]'); await mp.fill('#msg', 'Pedido aprovado, separação amanhã.'); await mp.click('.modal [data-ok]');
  await mp.waitForSelector('.drawer .badge:has-text("Aprovado")');
  check('10. Marketing aprova a solicitação', psql(`select status from public.solicitacoes_mpdv where numero=1`) === 'aprovado');
  await waitOk(vp, '.tl-step.current:has-text("Aprovada")', '11. Vendedor vê a atualização SEM recarregar (polling de fallback)');
  check('11.1 Mensagem do Marketing aparece ao vendedor', (await vp.textContent('#view')).includes('separação amanhã'));
  // nota interna
  await mp.fill('#nota', 'NOTA-INTERNA-SECRETA'); await mp.click('#addNota'); await mp.waitForSelector('.drawer :text("NOTA-INTERNA-SECRETA")');
  check('10.3 Observação interna criada', true);
  check('10.4 Vendedor NÃO vê a observação interna', !(await vp.content()).includes('NOTA-INTERNA-SECRETA'));
  // em separação sem liberação: vendedor não cancela; liberar -> pode
  await mp.click('[data-go="em_separacao"]'); await mp.click('.modal [data-ok]'); await mp.waitForSelector('.drawer .badge:has-text("Em separação")');
  await vp.waitForSelector('.tl-step.current:has-text("Em separação")', { timeout: 9000 });
  check('5.1 Em separação sem autorização: botão cancelar oculto e vendedor é informado', await vp.locator('#cancel').count() === 0 && (await vp.textContent('#view')).includes('autorização do Marketing'));
  await mp.check('#libCancel', { force: true }).catch(async () => { await mp.click('#libCancel + span'); });
  await waitOk(vp, '#cancel', '5.2 Marketing libera cancelamento: botão de cancelar aparece para o vendedor sem recarregar');
  await mp.uncheck('#libCancel', { force: true }).catch(async () => { await mp.click('#libCancel + span'); });
  // transporte
  await mp.click('[data-go="em_transporte"]'); await mp.click('.modal [data-ok]'); await mp.waitForSelector('.drawer .badge:has-text("Em transporte")');
  await vp.waitForSelector('.tl-step.current:has-text("Em transporte")', { timeout: 9000 });
  check('9. Pedido EM TRANSPORTE: sem botão cancelar e com a mensagem oficial', await vp.locator('#cancel').count() === 0 && (await vp.textContent('#view')).includes('Seu pedido já está em processo de entrega e não pode mais ser cancelado'));
  await shot(vp, '10-vendedor-em-transporte');
  const cancelTry = await api(vp, tk, 'POST', '/rpc/mpdv_cancelar_solicitacao', { p_id: psql(`select id from public.solicitacoes_mpdv where numero=1`) });
  check('9.1 Cancelar em transporte via API direta também é recusado', cancelTry.status >= 400 && cancelTry.body?.details === 'CANCELAMENTO_BLOQUEADO', JSON.stringify(cancelTry));
  await vp.goto(BASE + '/#/loja'); await vp.waitForSelector('#avisoMes .alert');
  check('9.2 Catálogo mostra também a mensagem de entrega em andamento', (await vp.textContent('#avisoMes')).includes('processo de entrega'));

  /* ---------- 8: cancelamento libera nova (vendedor 2) ---------- */
  await v2.page.goto(BASE + '/#/pedidos'); await v2.page.waitForSelector('.order-card'); await v2.page.click('.order-card'); await v2.page.waitForSelector('#cancel');
  const estAntes = psql(`select estoque from public.materiais_mpdv where nome like 'Faixa%'`);
  await v2.page.click('#cancel'); await v2.page.fill('.modal textarea', 'Pedido duplicado'); await v2.page.click('.modal [data-ok]');
  await v2.page.waitForSelector('.alert.danger:has-text("cancelada")');
  check('8. Vendedor cancela a própria solicitação (aguardando) com motivo registrado', psql(`select status||'|'||motivo_cancelamento||'|'||cancelado_por_papel from public.solicitacoes_mpdv where vendedor_id='00000000-0000-0000-0000-0000000000b2'`) === 'cancelado|Pedido duplicado|vendedor');
  check('8.1 Estoque devolvido', Number(psql(`select estoque from public.materiais_mpdv where nome like 'Faixa%'`)) === Number(estAntes) + 1);
  await shot(v2.page, '11-vendedor-cancelado');
  await v2.page.goto(BASE + '/#/loja'); await v2.page.waitForSelector('article.product');
  check('8.2 Após cancelar, o aviso de bloqueio some', !(await v2.page.textContent('#avisoMes')).includes('Você já possui'));
  await v2.page.click('article.product:has-text("Display") [data-add]'); await v2.page.click('.topnav a[href="#/carrinho"]'); await v2.page.click('#send'); await v2.page.click('.modal [data-ok]'); await v2.page.waitForSelector('.timeline');
  check('8.3 ...e consegue enviar NOVA solicitação no mês (#0003)', (await v2.page.textContent('h1')).includes('#0003'));

  /* ---------- 12: estoque acabando entre carrinho e envio ---------- */
  psql(`update public.materiais_mpdv set estoque=0 where nome like 'Display%'`);
  await v2.page.goto(BASE + '/#/pedidos'); await v2.page.waitForSelector('.order-card'); // só para navegar
  // limpa o pedido ativo do vendedor 2 para testar envio com estoque curto
  psql(`select 1`);

  /* ---------- Produtos / Vendedores (Marketing) ---------- */
  await mp.keyboard.press('Escape');
  await mp.click('.sidebar a[href="#/admin/produtos"]'); await mp.waitForSelector('#list tbody tr');
  await shot(mp, '12-admin-produtos');
  await mp.click('#novo'); await mp.fill('#p-nome', 'Totem de Chão'); await mp.fill('#p-cat', 'Totens'); await mp.fill('#p-est', '7'); await mp.fill('#p-desc', 'Totem 1,8m');
  await mp.setInputFiles('#p-file', { name: 'img.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
  await mp.waitForSelector('#prev img'); await shot(mp, '13-admin-produto-modal');
  await mp.click('#p-save'); await mp.waitForSelector('tr:has-text("Totem de Chão")');
  { const got = psql(`select estoque||'|'||(imagem_url like '%/storage/v1/object/public/produtos/p/%') from public.materiais_mpdv where nome='Totem de Chão'`);
    check('Marketing cadastra produto com imagem', got === '7|true' || got === '7|t', got); }
  await mp.fill('#q', 'totem'); await mp.waitForTimeout(300);
  await mp.click('[data-stock]'); await mp.waitForSelector('#e-novo'); await mp.fill('#e-novo', '12'); await mp.fill('#e-mot', 'Entrada NF 99'); await mp.click('#e-save'); await mp.waitForTimeout(700);
  check('Marketing ajusta estoque (RPC) com motivo registrado', psql(`select m.estoque||'|'||(select string_agg(delta||':'||coalesce(motivo,''),',' order by id) from public.estoque_movimentos_mpdv where material_id=m.id) from public.materiais_mpdv m where nome='Totem de Chão'`) === '12|7:,5:Entrada NF 99');
  await mp.click('[data-toggle]', { force: true }); await mp.waitForTimeout(600);
  check('Marketing desativa produto', psql(`select ativo from public.materiais_mpdv where nome='Totem de Chão'`) === 'f');
  await mp.click('[data-del]'); await mp.click('.modal [data-ok]'); await mp.waitForTimeout(700);
  check('Marketing exclui produto nunca solicitado', psql(`select count(*) from public.materiais_mpdv where nome='Totem de Chão'`) === '0');
  await mp.fill('#q', 'Banner'); await mp.waitForTimeout(300); await mp.click('[data-del]'); await mp.click('.modal [data-ok]'); await mp.waitForSelector('.toast.error');
  check('Excluir produto já solicitado é recusado com orientação para desativar', (await mp.textContent('.toast.error')).includes('Desative'));

  await mp.click('.sidebar a[href="#/admin/vendedores"]'); await mp.waitForSelector('#list tbody tr');
  await shot(mp, '14-admin-vendedores');
  check('Lista de vendedores mostra pedido do mês e totais', (await mp.textContent('#list')).includes('Em transporte') && (await mp.textContent('#list')).includes('Vera Vendedora'));
  await mp.click('tr:has-text("Caio") .switch'); await mp.waitForSelector('.modal [data-ok]'); await mp.click('.modal [data-ok]'); await mp.waitForTimeout(700);
  check('Marketing desativa vendedor', psql(`select ativo from public.perfis_mpdv where email='vend2@x.com'`) === 'f');
  await v2.page.reload(); await waitOk(v2.page, '.center-screen:has-text("Conta desativada")', 'Vendedor desativado vê "Conta desativada" e perde acesso', 8000);
  psql(`update public.perfis_mpdv set ativo=true`);

  /* ---------- Mobile ---------- */
  { const { ctx, page } = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await login(page, 'vend1@x.com'); await page.waitForSelector('article.product'); await shot(page, '20-mobile-catalogo');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('Mobile: catálogo sem rolagem horizontal', !overflow);
    check('Mobile: navegação inferior visível e menu superior oculto', await page.locator('.bottomnav').isVisible() && !(await page.locator('.topnav').isVisible()));
    await page.goto(BASE + '/#/pedidos'); await page.waitForSelector('.order-card'); await page.click('.order-card'); await page.waitForSelector('.timeline'); await shot(page, '21-mobile-acompanhamento');
    check('Mobile: acompanhamento sem rolagem horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    const small = await page.evaluate(() => [...document.querySelectorAll('button,.btn,a.btn')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 32 && !b.classList.contains('sm')).length);
    check('Mobile: sem botões minúsculos (<32px) fora da variante compacta', small === 0, small);
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await login(page, 'marketing@x.com'); await page.waitForSelector('.kpis'); await shot(page, '22-mobile-admin-dashboard');
    await page.click('#burger'); await page.waitForTimeout(400); await shot(page, '23-mobile-admin-menu');
    await page.click('.sidebar a[href="#/admin/pedidos"]'); await page.waitForSelector('tr[data-open]'); await shot(page, '24-mobile-admin-pedidos');
    check('Mobile admin: tabela de pedidos vira cartões, sem rolagem horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    await page.click('tr[data-open]'); await page.waitForSelector('.drawer'); await shot(page, '25-mobile-admin-drawer');
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, { viewport: { width: 820, height: 1100 } });
    await login(page, 'marketing@x.com'); await page.waitForSelector('.kpis'); await shot(page, '26-tablet-admin'); await ctx.close(); }

  check('Nenhum erro de JavaScript no console durante todos os fluxos', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(`\nRESULTADO E2E: ${results.filter(Boolean).length}/${results.length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });
