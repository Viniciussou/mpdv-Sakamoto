// Ponto de entrada: autenticação, identificação do perfil, roteamento e Realtime.
import { html, ic, mount, $, on, toast, busy, initials, pad } from './lib/dom.js';
import * as api from './api.js';
import { STATUS } from './api.js';
import { POLL_MS } from './config.js';
import { cart } from './cart.js';
import { alertBox } from './views/shared.js';
import { catalogoView, carrinhoView, pedidosView, pedidoDetalheView } from './views/vendedor.js';
import { dashboardView, pedidosAdminView, produtosView, vendedoresView } from './views/admin.js';

const app = document.getElementById('app');
let ctx = null;          // { perfil, uid, navigate }
let current = null;      // view atual { refresh, destroy }
let unsubRealtime = null, pollTimer = null, live = false, recovery = false, navToken = 0;
const lastStatus = new Map();

const logo = (small = true) => html`<span class="logo"><span class="logo-mark">${ic('package', 'lg')}</span><span>SAKAMOTO <b>MPDV</b>${small ? html`<small>Loja de materiais</small>` : ''}</span></span>`;

/* ---------------------------------------------------------------- telas de acesso */
function screenLoading(text = 'Carregando…') {
  mount(app, html`<div class="center-screen"><div class="stack center" style="align-items:center;gap:16px"><span class="spinner" style="width:34px;height:34px;color:var(--brand-600)"></span><p class="muted">${text}</p></div></div>`);
}
function authLayout(inner) {
  mount(app, html`<div class="auth-wrap">
    <aside class="auth-brand"><div>${logo()}</div>
      <div><h2>Solicite materiais de ponto de venda com agilidade.</h2>
        <ul><li>${ic('package')}<span>Catálogo atualizado com disponibilidade em tempo real.</span></li>
          <li>${ic('truck')}<span>Acompanhe cada etapa: análise, separação, transporte e entrega.</span></li>
          <li>${ic('shield')}<span>Acesso individual e seguro para cada vendedor.</span></li></ul></div>
      <p class="small" style="opacity:.65">© ${new Date().getFullYear()} Sakamoto · Loja MPDV</p></aside>
    <main class="auth-form-side"><div class="auth-card"><div class="auth-mobile-logo">${logo()}</div>${inner}</div></main></div>`);
}
function showLogin(notice) {
  authLayout(html`<h1>Acesse sua loja</h1><p class="muted" style="margin-bottom:24px">Entre com o e-mail e a senha cadastrados.</p>
    ${notice ? html`<div style="margin-bottom:16px">${notice}</div>` : ''}
    <form id="lf" class="stack" style="gap:16px" novalidate>
      <div class="field"><label for="email">E-mail</label><div class="input-wrap">${ic('mail')}<input id="email" class="input" type="email" autocomplete="email" required placeholder="seuemail@empresa.com.br"></div></div>
      <div class="field"><label for="pw">Senha</label><div class="input-wrap">${ic('lock')}<input id="pw" class="input" type="password" autocomplete="current-password" required placeholder="Sua senha"><button type="button" class="btn ghost icon sm reveal" data-reveal aria-label="Mostrar senha">${ic('eye')}</button></div></div>
      <div id="lerr" class="alert danger hidden" role="alert" style="animation:none"></div>
      <button class="btn block" id="lbtn" type="submit">Entrar</button>
      <button class="btn ghost block" id="forgot" type="button">Esqueci minha senha</button>
      <p class="xs muted center">Primeiro acesso? Use “Esqueci minha senha” para definir a sua senha.</p></form>`);
  const err = (t) => { const e = $('#lerr'); e.textContent = t; e.classList.toggle('hidden', !t); };
  const rv = $('[data-reveal]'); rv.addEventListener('click', () => { const i = $('#pw'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; rv.innerHTML = ic(show ? 'eye-off' : 'eye').s; });
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); err('');
    const email = $('#email').value.trim(), pw = $('#pw').value;
    if (!email || !pw) { err('Informe e-mail e senha.'); return; }
    await busy($('#lbtn'), async () => { try { await api.auth.signIn(email, pw); } catch (x) { err(api.toAppError(x).message); } });
  });
  $('#forgot').addEventListener('click', async (e) => {
    const email = $('#email').value.trim();
    if (!email) { err('Digite seu e-mail acima e clique novamente em “Esqueci minha senha”.'); $('#email').focus(); return; }
    await busy(e.currentTarget, async () => {
      try { await api.auth.reset(email); err(''); toast('Se o e-mail estiver cadastrado, você receberá um link para definir a senha.', 'info', 9000); }
      catch (x) { err(api.toAppError(x).message); }
    });
  });
}
function showRecovery() {
  recovery = true;
  authLayout(html`<h1>Definir nova senha</h1><p class="muted" style="margin-bottom:24px">Escolha uma senha com pelo menos 8 caracteres.</p>
    <form id="rf" class="stack" style="gap:16px" novalidate>
      <div class="field"><label for="np">Nova senha</label><div class="input-wrap">${ic('lock')}<input id="np" class="input" type="password" autocomplete="new-password" minlength="8" required></div></div>
      <div class="field"><label for="np2">Confirmar senha</label><div class="input-wrap">${ic('lock')}<input id="np2" class="input" type="password" autocomplete="new-password" minlength="8" required></div></div>
      <div id="rerr" class="alert danger hidden" role="alert" style="animation:none"></div>
      <button class="btn block" id="rbtn" type="submit">Salvar senha e entrar</button></form>`);
  $('#rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('#np').value, b = $('#np2').value, er = $('#rerr');
    const fail = (t) => { er.textContent = t; er.classList.remove('hidden'); };
    if (a.length < 8) return fail('A senha deve ter pelo menos 8 caracteres.');
    if (a !== b) return fail('As senhas não conferem.');
    await busy($('#rbtn'), async () => {
      try { await api.auth.setPassword(a); recovery = false; history.replaceState(null, '', location.pathname); toast('Senha definida com sucesso!'); const s = await api.auth.getSession(); if (s) await start(s); }
      catch (x) { fail(api.toAppError(x).message); }
    });
  });
}
function showBlocked(title, text) {
  mount(app, html`<div class="center-screen"><div class="card pad stack" style="max-width:440px;text-align:center;align-items:center">
    <div class="modal-ico tone-red">${ic('lock', 'lg')}</div><h2>${title}</h2><p class="muted">${text}</p>
    <button class="btn secondary" id="out">${ic('logout')}Sair</button></div></div>`);
  $('#out').addEventListener('click', () => api.auth.signOut());
}

/* ---------------------------------------------------------------- shells */
const VENDOR_NAV = [['/loja', 'Catálogo', 'store'], ['/carrinho', 'Carrinho', 'cart'], ['/pedidos', 'Meus pedidos', 'clipboard']];
const ADMIN_NAV = [['/admin', 'Dashboard', 'dashboard'], ['/admin/pedidos', 'Pedidos', 'clipboard'], ['/admin/produtos', 'Produtos', 'package'], ['/admin/vendedores', 'Vendedores', 'users']];

function shellVendedor() {
  const p = ctx.perfil;
  mount(app, html`<header class="topbar"><div class="topbar-in"><a href="#/loja" aria-label="Início">${logo(false)}</a>
      <nav class="topnav" aria-label="Principal">${VENDOR_NAV.map(([h, l, i]) => html`<a href="#${h}" data-nav="${h}">${ic(i)}${l}${h === '/carrinho' ? html`<span class="count-badge hidden" data-cartcount>0</span>` : ''}</a>`)}</nav>
      <div class="userbox"><span class="live-dot" id="live" title="Atualizações em tempo real"></span><div class="who"><b>${p.nome || p.email}</b><span class="xs muted">Vendedor</span></div><div class="avatar">${initials(p.nome || p.email)}</div>
        <button class="btn ghost icon sm" id="logout" aria-label="Sair" title="Sair">${ic('logout')}</button></div></div></header>
    <main id="view"></main>
    <nav class="bottomnav" aria-label="Principal">${VENDOR_NAV.map(([h, l, i]) => html`<a href="#${h}" data-nav="${h}">${ic(i, 'lg')}<span>${l === 'Meus pedidos' ? 'Pedidos' : l}</span>${h === '/carrinho' ? html`<span class="count-badge hidden" data-cartcount>0</span>` : ''}</a>`)}</nav>`);
  const upd = () => { const n = cart.count(); document.querySelectorAll('[data-cartcount]').forEach((e) => { e.textContent = n; e.classList.toggle('hidden', !n); }); };
  cart.onChange(upd); upd();
}
function shellAdmin() {
  const p = ctx.perfil;
  mount(app, html`<div class="admin-shell"><aside class="sidebar" id="sidebar"><a href="#/admin" aria-label="Início">${logo()}</a>
      <nav aria-label="Principal">${ADMIN_NAV.map(([h, l, i]) => html`<a href="#${h}" data-nav="${h}">${ic(i)}${l}${h === '/admin/pedidos' ? html`<span class="count-badge hidden" id="pendBadge">0</span>` : ''}</a>`)}</nav>
      <div class="side-foot"><div class="row"><div class="avatar">${initials(p.nome || p.email)}</div><div class="grow"><div class="strong small" style="color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.nome || p.email}</div><div class="xs" style="opacity:.7">Marketing <span class="live-dot" id="live" style="margin-left:4px" title="Atualizações em tempo real"></span></div></div></div>
        <button class="btn secondary sm block" id="logout">${ic('logout', 'sm')}Sair</button></div></aside>
    <div class="admin-main"><div class="admin-top"><button class="btn ghost icon" id="burger" aria-label="Abrir menu">${ic('menu')}</button>${logo(false)}</div><main id="view"></main></div></div>`);
  $('#burger').addEventListener('click', () => { $('#sidebar').classList.add('open'); const s = document.createElement('div'); s.className = 'scrim'; s.id = 'scrim'; document.body.append(s); s.addEventListener('click', closeMenu); });
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('[data-nav]')) closeMenu(); });
}
function closeMenu() { $('#sidebar')?.classList.remove('open'); document.getElementById('scrim')?.remove(); }

/* ---------------------------------------------------------------- roteador */
function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/', query, parts: (path || '/').split('/').filter(Boolean) };
}
function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', '#' + path); else if (location.hash !== '#' + path) { location.hash = path; return; }
  route();
}
async function route() {
  if (!ctx) return;
  const my = ++navToken;
  const { path, query, parts } = parseHash();
  const isAdmin = ctx.perfil.papel === 'marketing';
  // Guardas de rota (a segurança real está no banco; isto apenas organiza a navegação)
  if (isAdmin && parts[0] !== 'admin') return navigate('/admin', true);
  if (!isAdmin && (parts[0] === 'admin' || !parts.length || !['loja', 'carrinho', 'pedidos'].includes(parts[0]))) {
    if (parts[0] === 'admin') toast('Acesso restrito ao Marketing.', 'error');
    return navigate('/loja', true);
  }
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const h = a.dataset.nav; const on_ = h === '/admin' ? path === '/admin' : path === h || path.startsWith(h + '/');
    a.classList.toggle('active', on_); if (on_) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  current?.destroy?.(); current = null;
  const view = $('#view'); const fresh = view.cloneNode(false); view.replaceWith(fresh); // descarta listeners da view anterior
  window.scrollTo(0, 0);
  let h;
  try {
    if (isAdmin) {
      const sub = parts[1];
      h = !sub ? await dashboardView(fresh, ctx) : sub === 'pedidos' ? await pedidosAdminView(fresh, ctx, query)
        : sub === 'produtos' ? await produtosView(fresh, ctx, query) : sub === 'vendedores' ? await vendedoresView(fresh, ctx) : (navigate('/admin', true), null);
    } else {
      const r = parts[0];
      h = r === 'loja' ? await catalogoView(fresh, ctx) : r === 'carrinho' ? await carrinhoView(fresh, ctx)
        : parts[1] ? await pedidoDetalheView(fresh, ctx, parts[1]) : await pedidosView(fresh, ctx);
    }
  } catch (e) { mount(fresh, html`<div class="page">${alertBox('danger', 'Erro ao abrir a página', api.toAppError(e).message)}</div>`); }
  if (my === navToken) current = h; else h?.destroy?.();
}

/* ---------------------------------------------------------------- realtime */
const setLive = (v) => { live = v; document.getElementById('live')?.classList.toggle('on', v); };
let refreshT;
const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(() => current?.refresh?.(), 400); };
async function updatePendBadge() {
  if (ctx?.perfil.papel !== 'marketing') return;
  try { const d = await api.dashboard(null); const b = $('#pendBadge'); if (b) { b.textContent = d.aguardando_analise; b.classList.toggle('hidden', !d.aguardando_analise); } } catch { /* */ }
}
function startRealtime() {
  stopRealtime();
  unsubRealtime = api.subscribeRealtime({
    uid: ctx.uid, papel: ctx.perfil.papel,
    onStatus: (s) => setLive(s === 'SUBSCRIBED'),
    onEvent: (kind, p) => {
      if (kind === 'solicitacoes' && ctx.perfil.papel === 'vendedor' && p.new?.id) {
        const prev = lastStatus.get(p.new.id);
        if (prev && prev !== p.new.status) toast(`Seu pedido #${pad(p.new.numero)} agora está: ${STATUS[p.new.status]?.label || p.new.status}.`, p.new.status === 'cancelado' || p.new.status === 'rejeitado' ? 'error' : 'info', 9000);
        lastStatus.set(p.new.id, p.new.status);
      }
      if (kind === 'solicitacoes' && ctx.perfil.papel === 'marketing' && p.eventType === 'INSERT') toast(`Nova solicitação #${pad(p.new.numero)} recebida.`, 'info');
      refreshSoon(); updatePendBadge();
    },
  });
  pollTimer = setInterval(() => { if (!live && !document.hidden) { current?.refresh?.(); updatePendBadge(); } }, POLL_MS);
}
function stopRealtime() { unsubRealtime?.(); unsubRealtime = null; clearInterval(pollTimer); setLive(false); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx) { current?.refresh?.(); updatePendBadge(); } });

/* ---------------------------------------------------------------- ciclo de vida */
async function start(session) {
  if (recovery) return;
  screenLoading('Identificando seu perfil…');
  let perfil;
  try { perfil = await api.getPerfil(session.user.id); }
  catch (e) { return showBlocked('Não foi possível carregar seu perfil', api.toAppError(e).message); }
  if (!perfil) return showBlocked('Perfil não encontrado', 'Seu usuário ainda não possui perfil na loja. Fale com o Marketing para liberar seu acesso.');
  if (!perfil.ativo) return showBlocked('Conta desativada', 'Seu acesso à loja está desativado. Fale com o Marketing para reativá-lo.');
  ctx = { perfil, uid: session.user.id, navigate };
  if (perfil.papel === 'vendedor') {
    cart.load(ctx.uid);
    shellVendedor();
    try { (await api.listMinhasSolicitacoes()).forEach((s) => lastStatus.set(s.id, s.status)); } catch { /* */ }
  } else { shellAdmin(); updatePendBadge(); }
  $('#logout').addEventListener('click', () => api.auth.signOut());
  startRealtime();
  const { parts } = parseHash();
  if (!parts.length) navigate(perfil.papel === 'marketing' ? '/admin' : '/loja', true); else route();
}
function teardown() { stopRealtime(); current?.destroy?.(); current = null; ctx = null; lastStatus.clear(); closeMenu(); }

window.addEventListener('hashchange', () => { if (ctx) route(); });
api.auth.onChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { teardown(); return showRecovery(); }
  if (event === 'SIGNED_OUT') { teardown(); recovery = false; return showLogin(); }
  if (event === 'INITIAL_SESSION' && !session) { if (!recovery && !/type=recovery/.test(location.hash)) showLogin(); return; }
  if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) { if (ctx?.uid === session.user.id) return; await start(session); }
});
screenLoading();
