// Telas do VENDEDOR: catálogo, carrinho, meus pedidos e acompanhamento.
import { html, ic, mount, $, on, debounce, norm, toast, confirmDialog, openModal, busy, fmtDate, fmtDateTime, fmtMes, safeUrl } from '../lib/dom.js';
import * as api from '../api.js';
import { MSG, vendedorPodeCancelar } from '../api.js';
import { cart } from '../cart.js';
import { alertBox, emptyState, skeletonGrid, skeletonBlock, statusBadge, numeroFmt, thumb, stockInfo, timeline, encerramentoBox, historicoList, itensTable, totalItens } from './shared.js';

/* Mensagem de bloqueio mensal, conforme o status do pedido ativo (texto exigido pelo projeto) */
function avisoPedidoAtivo(sol, { link = true } = {}) {
  const a = link ? html`<a class="btn sm secondary" href="#/pedidos/${sol.id}" style="margin-top:8px">Acompanhar pedido ${ic('chevron-right', 'sm')}</a>` : '';
  const blocks = [html`<p>${MSG.JA_TEM}</p>`];
  if (sol.status === 'em_transporte') blocks.push(html`<p><b>${MSG.EM_ENTREGA}</b></p>`);
  if (sol.status === 'entregue') blocks.push(html`<p>Seu pedido foi entregue. Uma nova solicitação poderá ser feita no próximo mês.</p>`);
  return alertBox('warn', `Solicitação ${numeroFmt(sol.numero)} em andamento`, html`${blocks}`, a);
}

/* =====================================================================
   CATÁLOGO
   ===================================================================== */
export async function catalogoView(root, ctx) {
  let materiais = [], estado = null, categoria = 'Todos', q = '';
  mount(root, html`<div class="page">
    <div class="page-head"><div><h1>Catálogo de materiais</h1><p>Olá, ${ctx.perfil.nome || ctx.perfil.email}. Escolha os materiais de ponto de venda e monte sua solicitação mensal.</p></div></div>
    <div id="avisoMes" class="stack" style="margin-bottom:18px"></div>
    <div class="toolbar"><div class="input-wrap">${ic('search')}<input id="q" class="input" type="search" placeholder="Pesquisar materiais…" aria-label="Pesquisar materiais" autocomplete="off"></div></div>
    <div id="chips" class="chips" role="tablist" aria-label="Categorias" style="margin-bottom:16px"></div>
    <div id="grid">${skeletonGrid()}</div></div>`);

  function paintAviso() {
    const box = $('#avisoMes', root);
    if (estado?.solicitacao) { mount(box, avisoPedidoAtivo(estado.solicitacao)); return; }
    let dismissed = false; try { dismissed = sessionStorage.getItem('mpdv:aviso') === '1'; } catch { /* */ }
    mount(box, dismissed ? '' : alertBox('info', '', html`${MSG.AVISO_MENSAL}`, html`<button class="btn sm ghost" data-dismiss style="margin-top:6px">Entendi</button>`));
  }
  function paint() {
    const cats = ['Todos', ...new Set(materiais.map((m) => m.categoria || 'Outros'))];
    if (!cats.includes(categoria)) categoria = 'Todos';
    mount($('#chips', root), html`${cats.map((c) => html`<button class="chip ${c === categoria ? 'active' : ''}" data-cat="${c}" role="tab" aria-selected="${c === categoria}">${c}</button>`)}`);
    const nq = norm(q);
    const list = materiais.filter((m) => (categoria === 'Todos' || (m.categoria || 'Outros') === categoria) && (!nq || norm(m.nome + ' ' + (m.descricao || '') + ' ' + (m.categoria || '')).includes(nq)));
    mount($('#grid', root), list.length ? html`<div class="products">${list.map(card)}</div>`
      : emptyState('search', 'Nenhum material encontrado', materiais.length ? 'Tente outra busca ou categoria.' : 'O catálogo ainda não possui materiais disponíveis.'));
  }
  function card(m) {
    const s = stockInfo(m), inCart = cart.get(m.id), out = s.e <= 0;
    return html`<article class="product ${out ? 'out' : ''}" data-id="${m.id}">
      <div class="thumb">${thumb(m)}<span class="badge ${s.tone}">${s.label}</span></div>
      <div class="product-body"><div class="cat">${m.categoria || 'Outros'}</div><h3>${m.nome}</h3>${m.descricao ? html`<p class="desc">${m.descricao}</p>` : ''}
        <div class="product-actions">${inCart > 0
          ? html`<div class="stepper" role="group" aria-label="Quantidade de ${m.nome}"><button data-dec="${m.id}" aria-label="Diminuir">${ic('minus', 'sm')}</button><input type="number" min="0" max="${s.e}" value="${inCart}" data-qty="${m.id}" aria-label="Quantidade"><button data-inc="${m.id}" aria-label="Aumentar" ${inCart >= s.e ? 'disabled' : ''}>${ic('plus', 'sm')}</button></div>`
          : html`<button class="btn" data-add="${m.id}" ${out ? 'disabled' : ''}>${ic('plus')}${out ? 'Indisponível' : 'Adicionar'}</button>`}</div></div></article>`;
  }
  async function load() {
    [materiais, estado] = await Promise.all([api.listMateriais(), api.estadoMes()]);
    cart.reconcile(materiais); paintAviso(); paint();
  }
  const find = (id) => materiais.find((m) => String(m.id) === String(id));
  on(root, 'click', '[data-cat]', (_e, el) => { categoria = el.dataset.cat; paint(); });
  on(root, 'click', '[data-dismiss]', () => { try { sessionStorage.setItem('mpdv:aviso', '1'); } catch { /* */ } paintAviso(); });
  on(root, 'click', '[data-add]', (_e, el) => { const m = find(el.dataset.add); if (m && Number(m.estoque) > 0) { cart.add(m.id, 1); paint(); } });
  on(root, 'click', '[data-inc]', (_e, el) => { const m = find(el.dataset.inc); if (m) { cart.set(m.id, Math.min(Number(m.estoque), cart.get(m.id) + 1)); paint(); } });
  on(root, 'click', '[data-dec]', (_e, el) => { cart.set(el.dataset.dec, cart.get(el.dataset.dec) - 1); paint(); });
  on(root, 'change', '[data-qty]', (_e, el) => { const m = find(el.dataset.qty); if (m) { cart.set(m.id, Math.min(Number(m.estoque), Number(el.value) || 0)); paint(); } });
  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; paint(); }, 150));
  try { await load(); } catch (e) { mount($('#grid', root), alertBox('danger', 'Não foi possível carregar o catálogo', api.toAppError(e).message)); }
  return { refresh: async () => { try { await load(); } catch { /* mantém tela */ } }, destroy() {} };
}

/* =====================================================================
   CARRINHO
   ===================================================================== */
export async function carrinhoView(root, ctx) {
  let materiais = [], estado = null, obs = '';
  mount(root, html`<div class="page"><div class="page-head"><div><h1>Meu carrinho</h1><p>Revise os itens antes de enviar sua solicitação mensal.</p></div></div><div id="body">${skeletonBlock(260)}</div></div>`);

  function paint() {
    const lines = cart.entries().map(([id, q]) => ({ m: materiais.find((x) => String(x.id) === id), q })).filter((l) => l.m);
    const sol = estado?.solicitacao;
    const body = $('#body', root);
    if (!lines.length) {
      mount(body, html`${sol ? html`<div style="margin-bottom:18px">${avisoPedidoAtivo(sol)}</div>` : ''}<div class="card">${emptyState('cart', 'Seu carrinho está vazio', 'Explore o catálogo e adicione os materiais que você precisa.', html`<a class="btn" href="#/loja">Ver catálogo</a>`)}</div>`);
      return;
    }
    mount(body, html`${sol ? html`<div style="margin-bottom:18px">${avisoPedidoAtivo(sol)}</div>` : ''}
      <div class="cart-layout">
        <div class="card">${lines.map(({ m, q }) => { const s = stockInfo(m); return html`<div class="cart-item">
          <div class="thumb">${thumb(m)}</div>
          <div><div class="strong">${m.nome}</div><div class="xs muted">${m.categoria || 'Outros'} · ${s.e} disponíveis</div></div>
          <div class="cart-ctrl"><div class="stepper sm"><button data-dec="${m.id}" aria-label="Diminuir">${ic('minus', 'sm')}</button><input type="number" min="1" max="${s.e}" value="${q}" data-qty="${m.id}" aria-label="Quantidade de ${m.nome}"><button data-inc="${m.id}" aria-label="Aumentar" ${q >= s.e ? 'disabled' : ''}>${ic('plus', 'sm')}</button></div>
            <button class="btn ghost icon sm" data-rm="${m.id}" aria-label="Remover ${m.nome}" title="Remover">${ic('trash')}</button></div></div>`; })}</div>
        <aside class="card pad summary stack">
          <h2>Resumo</h2>
          <div class="row between"><span class="muted">Produtos diferentes</span><b>${lines.length}</b></div>
          <div class="row between"><span class="muted">Total de itens</span><b>${cart.count()}</b></div>
          <div class="field"><label for="obs">Observações (opcional)</label><textarea id="obs" class="textarea" maxlength="500" placeholder="Ex.: loja de destino, prazo desejado…">${obs}</textarea></div>
          ${sol ? html`<button class="btn block" disabled>${ic('lock')}Envio bloqueado neste mês</button>` : html`<button id="send" class="btn block">${ic('check')}Enviar solicitação</button>`}
          ${sol ? '' : html`<p class="xs muted">${MSG.AVISO_MENSAL.replace('⚠️ ', '')}</p>`}
        </aside></div>`);
  }
  async function load() { [materiais, estado] = await Promise.all([api.listMateriais(), api.estadoMes()]); cart.reconcile(materiais); paint(); }
  const find = (id) => materiais.find((m) => String(m.id) === String(id));
  const keep = () => { obs = $('#obs', root)?.value ?? obs; };
  on(root, 'click', '[data-inc]', (_e, el) => { keep(); const m = find(el.dataset.inc); if (m) cart.set(m.id, Math.min(Number(m.estoque), cart.get(m.id) + 1)); paint(); });
  on(root, 'click', '[data-dec]', (_e, el) => { keep(); cart.set(el.dataset.dec, Math.max(1, cart.get(el.dataset.dec) - 1)); paint(); });
  on(root, 'click', '[data-rm]', (_e, el) => { keep(); cart.remove(el.dataset.rm); paint(); });
  on(root, 'change', '[data-qty]', (_e, el) => { keep(); const m = find(el.dataset.qty); if (m) cart.set(m.id, Math.max(1, Math.min(Number(m.estoque), Number(el.value) || 1))); paint(); });
  on(root, 'input', '#obs', (_e, el) => { obs = el.value; });
  on(root, 'click', '#send', async (_e, btn) => {
    keep();
    const ok = await confirmDialog({ title: 'Enviar solicitação?', tone: 'warn', icon: 'alert', confirmText: 'Sim, enviar solicitação', cancelText: 'Revisar carrinho',
      message: html`<div class="alert warn" style="animation:none">${ic('alert', 'lg')}<div>${MSG.AVISO_MENSAL.replace('⚠️ ', '')}</div></div><p class="small muted">${cart.lines()} produto(s) · ${cart.count()} item(ns) serão reservados no estoque.</p>` });
    if (!ok) return;
    await busy(btn, async () => {
      try {
        const itens = cart.entries().map(([material_id, quantidade]) => ({ material_id, quantidade }));
        const r = await api.criarSolicitacao(itens, obs);
        cart.clear(); obs = '';
        toast(`Solicitação ${numeroFmt(r.numero)} enviada com sucesso!`);
        ctx.navigate(`/pedidos/${r.id}`);
      } catch (e) {
        const err = api.toAppError(e);
        toast(err.message, 'error', 8000);
        await load().catch(() => {});
      }
    });
  });
  try { await load(); } catch (e) { mount($('#body', root), alertBox('danger', 'Não foi possível carregar o carrinho', api.toAppError(e).message)); }
  return { refresh: async () => { keep(); try { await load(); } catch { /* */ } }, destroy() {} };
}

/* =====================================================================
   MEUS PEDIDOS
   ===================================================================== */
export async function pedidosView(root, ctx) {
  mount(root, html`<div class="page"><div class="page-head"><div><h1>Meus pedidos</h1><p>Histórico e andamento das suas solicitações.</p></div></div><div id="aviso"></div><div id="list" class="card">${skeletonBlock(200)}</div></div>`);
  async function load() {
    const [list, estado] = await Promise.all([api.listMinhasSolicitacoes(), api.estadoMes()]);
    mount($('#aviso', root), estado.solicitacao ? html`<div style="margin-bottom:18px">${avisoPedidoAtivo(estado.solicitacao, { link: false })}</div>` : '');
    mount($('#list', root), list.length ? html`${list.map((s) => html`<a class="order-card" href="#/pedidos/${s.id}">
      <div><div class="row wrap" style="gap:10px"><span class="order-num">${numeroFmt(s.numero)}</span>${statusBadge(s.status)}</div>
        <div class="small muted" style="margin-top:4px">${fmtDateTime(s.criado_em)} · ${totalItens(s)} item(ns) · referência ${fmtMes(s.mes_referencia)}</div></div>
      <span class="muted">${ic('chevron-right')}</span></a>`)}`
      : emptyState('clipboard', 'Você ainda não fez nenhuma solicitação', 'Quando enviar a primeira, ela aparecerá aqui com todo o andamento.', html`<a class="btn" href="#/loja">Ir ao catálogo</a>`));
  }
  try { await load(); } catch (e) { mount($('#list', root), alertBox('danger', 'Erro ao carregar pedidos', api.toAppError(e).message)); }
  return { refresh: () => load().catch(() => {}), destroy() {} };
}

/* =====================================================================
   DETALHE / ACOMPANHAMENTO
   ===================================================================== */
export async function pedidoDetalheView(root, ctx, id) {
  mount(root, html`<div class="page"><a class="btn ghost sm" href="#/pedidos">${ic('chevron-left', 'sm')}Meus pedidos</a><div id="body" style="margin-top:12px">${skeletonBlock(420)}</div></div>`);
  let s = null;
  function paint() {
    const body = $('#body', root);
    if (!s) { mount(body, emptyState('alert_circle', 'Solicitação não encontrada', 'Ela não existe ou não pertence à sua conta.', html`<a class="btn" href="#/pedidos">Voltar</a>`)); return; }
    let rodape;
    if (vendedorPodeCancelar(s)) rodape = html`<button class="btn danger-outline" id="cancel">${ic('ban')}Cancelar solicitação</button>`;
    else if (s.status === 'em_transporte') rodape = alertBox('warn', '', html`${MSG.EM_ENTREGA}`);
    else if (s.status === 'em_separacao') rodape = alertBox('info', '', html`Seu pedido está em separação. Para cancelá-lo é necessária a autorização do Marketing.`);
    else if (s.status === 'entregue') rodape = alertBox('success', 'Pedido entregue', html`Obrigado! Uma nova solicitação poderá ser feita no próximo mês.`);
    else rodape = '';
    mount(body, html`<div class="stack" style="gap:20px">
      <div class="page-head" style="margin:0"><div><div class="row wrap" style="gap:12px"><h1>Solicitação ${numeroFmt(s.numero)}</h1>${statusBadge(s.status)}</div><p>Enviada em ${fmtDateTime(s.criado_em)} · referência ${fmtMes(s.mes_referencia)}</p></div></div>
      <div class="card pad"><div class="section-title">Andamento</div>${timeline(s)}</div>
      ${encerramentoBox(s, 'vendedor')}
      ${rodape}
      <div class="dash-grid" style="margin-top:0"><div><div class="section-title">Itens solicitados (${totalItens(s)})</div>${itensTable(s)}
        ${s.observacao_vendedor ? html`<div class="card pad" style="margin-top:14px"><div class="section-title">Sua observação</div><p class="small" style="white-space:pre-line">${s.observacao_vendedor}</p></div>` : ''}</div>
        <div><div class="section-title">Atualizações</div><div class="card pad">${historicoList(s)}</div></div></div></div>`);
  }
  async function load() { s = await api.getSolicitacao(id); paint(); }
  on(root, 'click', '#cancel', async () => {
    const motivoId = 'motivo-' + Math.random().toString(36).slice(2, 6);
    const m = openModal(html`<div class="modal-head"><div class="row" style="align-items:flex-start;gap:14px"><div class="modal-ico tone-red">${ic('ban', 'lg')}</div><div><h2>Cancelar solicitação ${numeroFmt(s.numero)}?</h2><p class="muted small" style="margin-top:4px">O estoque será liberado e você poderá fazer uma nova solicitação neste mês.</p></div></div></div>
      <div class="modal-body"><div class="field"><label for="${motivoId}">Motivo (opcional)</label><textarea id="${motivoId}" class="textarea" maxlength="500" placeholder="Conte brevemente o motivo"></textarea></div></div>
      <div class="modal-foot"><button class="btn secondary" data-close>Manter solicitação</button><button class="btn danger" data-ok>Cancelar solicitação</button></div>`);
    $('[data-ok]', m.el).addEventListener('click', async (ev) => {
      await busy(ev.currentTarget, async () => {
        try { await api.cancelarSolicitacao(s.id, $('textarea', m.el).value); m.close(); toast('Solicitação cancelada. Você já pode fazer uma nova solicitação.'); await load(); }
        catch (e) { toast(api.toAppError(e).message, 'error', 8000); m.close(); await load().catch(() => {}); }
      });
    });
  });
  try { await load(); } catch (e) { mount($('#body', root), alertBox('danger', 'Erro ao carregar', api.toAppError(e).message)); }
  return { refresh: () => load().catch(() => {}), destroy() {} };
}
