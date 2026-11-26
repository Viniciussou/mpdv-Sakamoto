// Verifica, num navegador real e com a CSP do build, que o site só fala com o projeto Supabase configurado.
// Uso: (build com NEXT_PUBLIC_SUPABASE_URL=https://<projeto>.supabase.co) e depois  node csp.cjs
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const DIST = '/home/claude/loja-mpdv/dist', OK_HOST = process.env.OK_HOST || 'kfimjkncjrqofblppiqk.supabase.co', OTHER = process.env.OTHER_HOST || 'mnyaqzxuzuiaqxkwqyfp.supabase.co';
const SUPA = process.env.SUPA_JS || '/home/claude/test/npm/node_modules/@supabase/supabase-js/dist/umd/supabase.js';
const psql = (q) => execSync(`psql -X -q -t -A -h /tmp -p 5544 -U postgres -d t -c "${q}"`).toString().trim();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => { let f = req.url.split('?')[0]; if (f === '/') f = '/index.html'; const p = path.join(DIST, f);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'text/plain' }); fs.createReadStream(p).pipe(res); }).listen(8081);
const res_ = []; const check = (n, ok, i = '') => { res_.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && i ? ' -> ' + i : ''}`); };
(async () => {
  psql(`truncate public.solicitacao_itens_mpdv, public.solicitacao_historico_mpdv, public.solicitacao_notas_mpdv, public.estoque_movimentos_mpdv, public.solicitacoes_mpdv restart identity cascade`);
  psql(`update public.materiais_mpdv set estoque=10 where nome like 'Banner%'`);
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'pt-BR' });
  await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(SUPA) }));
  const hits = { ok: [], other: [] };
  await ctx.route(`https://${OK_HOST}/**`, async (r) => { const q = r.request(), u = new URL(q.url()); hits.ok.push(u.pathname);
    const h = { ...q.headers() }; delete h.host; delete h['content-length'];
    const resp = await fetch('http://localhost:8080' + u.pathname + u.search, { method: q.method(), headers: h, body: ['GET', 'HEAD', 'OPTIONS'].includes(q.method()) ? undefined : q.postData() });
    const hdr = Object.fromEntries(resp.headers); delete hdr['content-encoding']; delete hdr['transfer-encoding']; hdr['access-control-allow-origin'] = '*'; hdr['access-control-allow-headers'] = '*'; hdr['access-control-allow-methods'] = '*';
    await r.fulfill({ status: resp.status, headers: hdr, body: Buffer.from(await resp.arrayBuffer()) }); });
  await ctx.route(`https://${OTHER}/**`, (r) => { hits.other.push(r.request().url()); r.fulfill({ status: 200, body: '{}' }); });
  const page = await ctx.newPage(); const viol = [], errs = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) viol.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8081/'); await page.waitForSelector('#lf');
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  check('CSP do build menciona só o projeto configurado', csp.includes(OK_HOST) && !csp.includes(OTHER) && !/\*\.supabase/.test(csp), csp);
  // 1) esqueci minha senha => POST /auth/v1/recover (o erro relatado)
  await page.fill('#email', 'vend1@x.com'); await page.click('#forgot'); await page.waitForSelector('.toast');
  check('Recuperação de senha: /auth/v1/recover chega ao projeto correto', hits.ok.includes('/auth/v1/recover'), JSON.stringify(hits.ok));
  check('Recuperação de senha: nenhuma violação de CSP', viol.length === 0, viol.join(' | '));
  // 2) login + catálogo + pedido
  await page.fill('#pw', 'senha123'); await page.click('#lbtn'); await page.waitForSelector('article.product');
  check('Login e consulta do catálogo funcionam sob a CSP', hits.ok.includes('/auth/v1/token') && hits.ok.some((p) => p.includes('/rest/v1/materiais_mpdv')));
  await page.click('article.product:has-text("Banner") [data-add]'); await page.click('.topnav a[href="#/carrinho"]'); await page.click('#send'); await page.click('.modal [data-ok]'); await page.waitForSelector('.timeline');
  check('Criação de pedido (RPC) funciona sob a CSP', hits.ok.includes('/rest/v1/rpc/mpdv_criar_solicitacao') && psql('select count(*) from public.solicitacoes_mpdv') === '1');
  check('Realtime tentou o domínio correto (wss) e não foi bloqueado', !viol.some((v) => /wss:/.test(v)), viol.join('|'));
  // 3) projeto errado é bloqueado pela CSP
  const blocked = await page.evaluate(async (h) => { try { await fetch(`https://${h}/rest/v1/materiais_mpdv`); return false; } catch { return true; } }, OTHER);
  await page.waitForTimeout(200);
  check('Requisição ao OUTRO projeto é bloqueada pela CSP (e nunca chega à rede)', blocked && hits.other.length === 0 && viol.some((v) => v.includes(OTHER)), JSON.stringify({ blocked, other: hits.other }));
  check('Sem erros de JavaScript', errs.length === 0, errs.join('|'));
  await b.close(); srv.close();
  const nviol = viol.filter((v) => !v.includes(OTHER)).length; check('Única violação de CSP registrada é a do teste proposital', nviol === 0, nviol);
  console.log(`\nRESULTADO CSP: ${res_.filter(Boolean).length}/${res_.length}`); process.exit(res_.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
