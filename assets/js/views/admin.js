// Telas do MARKETING (acesso administrativo). A autorização real é feita pelo banco (RLS + RPCs).
import { html, ic, raw, mount, $, $$, on, debounce, norm, toast, confirmDialog, openModal, busy, fmtDate, fmtDateTime, fmtMes, fmtNum, initials, safeUrl } from '../lib/dom.js';
import * as api from '../api.js';
import { STATUS, TRANSICOES } from '../api.js';
import { alertBox, emptyState, skeletonBlock, statusBadge, numeroFmt, thumb, stockInfo, timeline, encerramentoBox, historicoList, itensTable, totalItens } from './shared.js';

const TONE_COLOR = { amber: '#e6a817', blue: '#3b82f6', violet: '#8b5cf6', indigo: '#6366f1', green: '#22a06b', red: '#e5584a' };
const mesesOpts = () => { // últimos 12 meses (apenas filtro de visualização)
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = 0; i < 12; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`); d.setMonth(d.getMonth() - 1); }
  return out;
};
const mesSelect = (id, val, label = 'Todos os meses') => html`<select id="${id}" class="select" aria-label="Mês de referência" style="width:auto"><option value="">${label}</option>${mesesOpts().map((m) => html`<option value="${m}" ${m === val ? 'selected' : ''}>${fmtMes(m)}</option>`)}</select>`;

/* =====================================================================
   DASHBOARD
   ===================================================================== */
export async function dashboardView(root, ctx) {
  let mes = '';
  mount(root, html`<div class="page"><div class="page-head"><div><h1>Dashboard</h1><p>Visão geral das solicitações de materiais.</p></div><div class="row">${mesSelect('mes', mes)}<button class="btn secondary icon" id="reload" aria-label="Atualizar" title="Atualizar">${ic('refresh')}</button></div></div><div id="body">${skeletonBlock(300)}</div></div>`);
  function kpi(label, num, icon, tone, href, sub) {
    const inner = html`<div class="kpi-ico tone-${tone}">${ic(icon, 'lg')}</div><div class="num">${fmtNum(num)}</div><div class="lbl">${label}${sub ? html` <span class="xs faint">${sub}</span>` : ''}</div>`;
    return href ? html`<a class="card kpi" href="${href}">${inner}</a>` : html`<div class="card kpi">${inner}</div>`;
  }
  async function load() {
    const [d, sols] = await Promise.all([api.dashboard(mes || null), api.listSolicitacoesAdmin()]);
    const seg = [['aguardando_analise', 'amber'], ['aprovado', 'blue'], ['em_separacao', 'violet'], ['em_transporte', 'indigo'], ['entregue', 'green'], ['cancelado', 'red'], ['rejeitado', 'red']];
    const tot = d.total || 0;
    const recentes = sols.filter((s) => !mes || s.mes_referencia === mes).slice(0, 6);
    mount($('#body', root), html`
      <div class="kpis">
        ${kpi('Total de solicitações', d.total, 'layers', 'brand', '#/admin/pedidos')}
        ${kpi('Aguardando análise', d.aguardando_analise, 'clock', 'amber', '#/admin/pedidos?status=aguardando_analise')}
        ${kpi('Aprovadas', d.aprovado, 'check-circle', 'blue', '#/admin/pedidos?status=aprovado')}
        ${kpi('Em separação', d.em_separacao, 'package', 'violet', '#/admin/pedidos?status=em_separacao')}
        ${kpi('Em transporte', d.em_transporte, 'truck', 'indigo', '#/admin/pedidos?status=em_transporte')}
        ${kpi('Entregues', d.entregue, 'check', 'green', '#/admin/pedidos?status=entregue')}
        ${kpi('Canceladas', d.cancelado, 'ban', 'red', '#/admin/pedidos?status=cancelado')}
        ${kpi('Rejeitadas', d.rejeitado, 'x', 'red', '#/admin/pedidos?status=rejeitado')}
        ${kpi('Vendedores ativos', d.vendedores_ativos, 'users', 'gray', '#/admin/vendedores', `(de ${d.vendedores_total} cadastrados)`)}
        ${kpi('Estoque baixo', d.estoque_baixo, 'alert', d.estoque_baixo ? 'amber' : 'green', '#/admin/produtos?baixo=1', '(produtos)')}
      </div>
      <div class="card pad" style="margin-top:20px"><div class="row between"><h3>Distribuição por status</h3><span class="small muted">${tot} solicitação(ões)</span></div>
        <div class="bar" style="margin-top:14px" role="img" aria-label="Distribuição das solicitações por status">${tot ? seg.map(([k, t]) => d[k] ? raw(`<i style="width:${(d[k] / tot) * 100}%;background:${TONE_COLOR[t]}" title="${STATUS[k].label}: ${d[k]}"></i>`) : '') : ''}</div>
        <div class="legend">${seg.map(([k, t]) => html`<span style="--c:${TONE_COLOR[t]}">${STATUS[k].label} <b>${d[k]}</b></span>`)}</div></div>
      <div class="dash-grid">
        <div class="card"><div class="card-head"><h3>Solicitações recentes</h3><a class="btn sm secondary" href="#/admin/pedidos">Ver todas</a></div>
          ${recentes.length ? html`<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Nº</th><th>Vendedor</th><th>Status</th><th>Data</th></tr></thead><tbody>${recentes.map((s) => html`<tr class="clickable" data-open="${s.id}"><td data-label="Nº" class="strong">${numeroFmt(s.numero)}</td><td data-label="Vendedor">${s.vendedor?.nome || s.vendedor?.email || '—'}</td><td data-label="Status">${statusBadge(s.status)}</td><td data-label="Data" class="muted">${fmtDateTime(s.criado_em)}</td></tr>`)}</tbody></table></div>` : emptyState('clipboard', 'Nenhuma solicitação', 'Quando os vendedores enviarem pedidos, eles aparecem aqui.')}</div>
        <div class="card"><div class="card-head"><h3>Estoque baixo</h3><a class="btn sm secondary" href="#/admin/produtos?baixo=1">Ver produtos</a></div>
          ${d.estoque_baixo_itens.length ? html`<div>${d.estoque_baixo_itens.map((p) => html`<div class="row between" style="padding:12px 20px;border-bottom:1px solid var(--line)"><div><div class="strong">${p.nome}</div><div class="xs muted">mínimo ${p.minimo}</div></div><span class="badge ${p.estoque <= 0 ? 'red' : 'amber'}">${p.estoque <= 0 ? 'Esgotado' : p.estoque + ' un.'}</span></div>`)}</div>` : emptyState('check-circle', 'Estoque saudável', 'Nenhum produto abaixo do mínimo.')}</div>
      </div>`);
  }
  on(root, 'change', '#mes', async (_e, el) => { mes = el.value; await load().catch(() => {}); });
  on(root, 'click', '#reload', () => load().catch((e) => toast(api.toAppError(e).message, 'error')));
  on(root, 'click', '[data-open]', (_e, el) => openPedidoDrawer(el.dataset.open, () => load().catch(() => {})));
  try { await load(); } catch (e) { mount($('#body', root), alertBox('danger', 'Erro ao carregar o dashboard', api.toAppError(e).message)); }
  return { refresh: () => load().catch(() => {}), destroy() {} };
}

/* =====================================================================
   PEDIDOS
   ===================================================================== */
export async function pedidosAdminView(root, ctx, query = {}) {
  let all = [], status = query.status || '', mes = '', q = '';
  mount(root, html`<div class="page"><div class="page-head"><div><h1>Pedidos</h1><p>Todas as solicitações dos vendedores. Clique em uma linha para gerenciar.</p></div></div>
    <div class="toolbar"><div class="input-wrap">${ic('search')}<input id="q" class="input" type="search" placeholder="Buscar por nº, vendedor ou e-mail…" aria-label="Buscar pedidos" autocomplete="off"></div>
      <select id="st" class="select" aria-label="Filtrar por status" style="width:auto"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${k === status ? 'selected' : ''}>${v.label}</option>`)}</select>${mesSelect('mes', mes)}
      <button class="btn secondary icon" id="reload" aria-label="Atualizar" title="Atualizar">${ic('refresh')}</button></div>
    <div id="list" class="card">${skeletonBlock(260)}</div></div>`);
  function paint() {
    const nq = norm(q);
    const rows = all.filter((s) => (!status || s.status === status) && (!mes || s.mes_referencia === mes)
      && (!nq || norm(`${s.numero} ${s.vendedor?.nome || ''} ${s.vendedor?.email || ''}`).includes(nq)));
    mount($('#list', root), rows.length ? html`<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Nº</th><th>Vendedor</th><th>Referência</th><th class="right">Itens</th><th>Status</th><th>Criado em</th><th></th></tr></thead><tbody>
      ${rows.map((s) => html`<tr class="clickable" data-open="${s.id}">
        <td class="cell-main"><span class="strong">${numeroFmt(s.numero)}</span></td>
        <td data-label="Vendedor"><div class="strong">${s.vendedor?.nome || '—'}</div><div class="xs muted">${s.vendedor?.email || ''}</div></td>
        <td data-label="Referência" class="muted">${fmtMes(s.mes_referencia)}</td>
        <td data-label="Itens" class="right">${totalItens(s)}</td>
        <td data-label="Status">${statusBadge(s.status)}</td>
        <td data-label="Criado em" class="muted nowrap">${fmtDateTime(s.criado_em)}</td>
        <td class="cell-actions right"><button class="btn sm secondary">Gerenciar ${ic('chevron-right', 'sm')}</button></td></tr>`)}</tbody></table></div>
      <div class="small muted" style="padding:12px 20px;border-top:1px solid var(--line)">${rows.length} de ${all.length} solicitação(ões)</div>`
      : emptyState('clipboard', 'Nenhuma solicitação encontrada', 'Ajuste os filtros ou aguarde novos pedidos.'));
  }
  async function load() { all = await api.listSolicitacoesAdmin(); paint(); }
  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; paint(); }, 150));
  on(root, 'change', '#st', (_e, el) => { status = el.value; paint(); });
  on(root, 'change', '#mes', (_e, el) => { mes = el.value; paint(); });
  on(root, 'click', '#reload', () => load().catch((e) => toast(api.toAppError(e).message, 'error')));
  on(root, 'click', '[data-open]', (_e, el) => openPedidoDrawer(el.dataset.open, () => load().catch(() => {})));
  try { await load(); } catch (e) { mount($('#list', root), alertBox('danger', 'Erro ao carregar pedidos', api.toAppError(e).message)); }
  return { refresh: () => load().catch(() => {}), destroy() {} };
}

/* ---------- Drawer de gerenciamento de um pedido ---------- */
const ACTIONS = {
  aprovado: { label: 'Aprovar', icon: 'check-circle', primary: true },
  em_separacao: { label: 'Iniciar separação', icon: 'package', primary: true },
  em_transporte: { label: 'Enviar para transporte', icon: 'truck', primary: true },
  entregue: { label: 'Marcar como entregue', icon: 'check', primary: true },
  rejeitado: { label: 'Rejeitar', icon: 'x', danger: true },
  cancelado: { label: 'Cancelar pedido', icon: 'ban', danger: true },
};
const BACK_LABEL = { aguardando_analise: 'Voltar para análise', aprovado: 'Voltar para aprovado', em_separacao: 'Voltar para separação' };

function askMessage({ title, desc, status, required = false, tone = 'brand', confirmText }) {
  return new Promise((resolve) => {
    let val = null;
    const m = openModal(html`<div class="modal-head"><div class="row" style="align-items:flex-start;gap:14px"><div class="modal-ico ${tone === 'danger' ? 'tone-red' : 'tone-brand'}">${ic(ACTIONS[status]?.icon || 'info', 'lg')}</div><div><h2>${title}</h2><p class="muted small" style="margin-top:4px">${desc}</p></div></div></div>
      <div class="modal-body"><div class="field"><label for="msg">Mensagem para o vendedor ${required ? '' : '(opcional)'}</label><textarea id="msg" class="textarea" maxlength="500" placeholder="Aparece na linha do tempo do vendedor"></textarea></div></div>
      <div class="modal-foot"><button class="btn secondary" data-close>Voltar</button><button class="btn ${tone === 'danger' ? 'danger' : ''}" data-ok>${confirmText}</button></div>`,
      { onClose: () => resolve(val) });
    $('[data-ok]', m.el).addEventListener('click', () => { const t = $('#msg', m.el).value.trim(); if (required && !t) { $('#msg', m.el).focus(); return; } val = t; m.close(); });
  });
}

export async function openPedidoDrawer(id, onChanged) {
  const d = openModal(html`<div class="drawer-body">${skeletonBlock(300)}</div>`, { drawer: true });
  let s = null, notas = [];
  async function load() {
    [s, notas] = await Promise.all([api.getSolicitacao(id), api.listNotas(id)]);
    paint();
  }
  function paint() {
    if (!s) { d.setContent(html`<div class="drawer-body">${emptyState('alert_circle', 'Solicitação não encontrada', '')}</div>`); return; }
    const next = TRANSICOES[s.status] || [];
    const forward = next.filter((n) => ['aprovado', 'em_separacao', 'em_transporte', 'entregue'].includes(n) && STATUS_IDX(n) > STATUS_IDX(s.status));
    const back = next.filter((n) => ['aguardando_analise', 'aprovado', 'em_separacao'].includes(n) && STATUS_IDX(n) < STATUS_IDX(s.status));
    const danger = next.filter((n) => n === 'rejeitado' || n === 'cancelado');
    const terminal = !next.length;
    d.setContent(html`
      <div class="drawer-head"><div><div class="row wrap" style="gap:10px"><h2>Solicitação ${numeroFmt(s.numero)}</h2>${statusBadge(s.status)}</div><p class="small muted" style="margin-top:4px">Criada em ${fmtDateTime(s.criado_em)} · referência ${fmtMes(s.mes_referencia)}</p></div><button class="btn ghost icon" data-close aria-label="Fechar">${ic('x')}</button></div>
      <div class="drawer-body">
        <section><div class="section-title">Vendedor</div><div class="row"><div class="avatar">${initials(s.vendedor?.nome || s.vendedor?.email)}</div><div><div class="strong">${s.vendedor?.nome || '—'}</div><div class="small muted">${s.vendedor?.email || ''}</div></div></div></section>
        <section><div class="section-title">Andamento</div><div class="card pad">${timeline(s)}</div></section>
        ${encerramentoBox(s, 'admin')}
        <section><div class="section-title">Ações</div>
          ${terminal ? html`<p class="small muted">Esta solicitação está encerrada (${STATUS[s.status].label.toLowerCase()}) e não pode mais ser alterada.</p>` : html`<div class="row wrap">
            ${forward.map((n) => html`<button class="btn" data-go="${n}">${ic(ACTIONS[n].icon)}${ACTIONS[n].label}</button>`)}
            ${danger.filter((n) => n === 'rejeitado').map((n) => html`<button class="btn danger-outline" data-go="${n}">${ic(ACTIONS[n].icon)}${ACTIONS[n].label}</button>`)}</div>
            <div class="row wrap" style="margin-top:10px">${back.map((n) => html`<button class="btn secondary sm" data-go="${n}">${ic('chevron-left', 'sm')}${BACK_LABEL[n]}</button>`)}
              ${danger.filter((n) => n === 'cancelado').map((n) => html`<button class="btn danger-outline sm" data-go="${n}">${ic('ban', 'sm')}Cancelar pedido</button>`)}</div>
            ${['aguardando_analise', 'aprovado', 'em_separacao'].includes(s.status) ? html`<label class="row" style="margin-top:16px;gap:12px;cursor:pointer"><span class="switch"><input type="checkbox" id="libCancel" ${s.cancelamento_liberado ? 'checked' : ''}><span></span></span><span class="small"><b>Permitir cancelamento pelo vendedor</b><br><span class="muted">${s.status === 'em_separacao' ? 'Em separação, o vendedor só cancela com a sua autorização.' : 'Neste status o vendedor já pode cancelar.'}</span></span></label>` : ''}`}
        </section>
        <section><div class="section-title">Itens (${totalItens(s)})</div>${itensTable(s)}${s.observacao_vendedor ? html`<div class="card pad" style="margin-top:12px"><div class="section-title">Observação do vendedor</div><p class="small" style="white-space:pre-line">${s.observacao_vendedor}</p></div>` : ''}</section>
        <section><div class="section-title">Observações internas <span class="badge" style="text-transform:none;letter-spacing:0">${ic('lock')}só Marketing</span></div>
          <div class="field"><textarea id="nota" class="textarea" maxlength="2000" placeholder="Anotação interna — o vendedor não vê"></textarea><div><button class="btn sm secondary" id="addNota">${ic('plus', 'sm')}Adicionar observação</button></div></div>
          <div class="stack" style="margin-top:12px;gap:8px">${notas.map((n) => html`<div class="card pad" style="padding:12px 14px;background:var(--surface-2)"><p class="small" style="white-space:pre-line">${n.texto}</p><div class="xs muted" style="margin-top:4px">${fmtDateTime(n.criado_em)}</div></div>`)}</div></section>
        <section><div class="section-title">Histórico</div><div class="card pad">${historicoList(s)}</div></section>
      </div>`);
  }
  const STATUS_IDX = (k) => ['aguardando_analise', 'aprovado', 'em_separacao', 'em_transporte', 'entregue'].indexOf(k);
  const done = async () => { await load(); onChanged?.(); };
  on(d.el, 'click', '[data-go]', async (_e, btn) => {
    const to = btn.dataset.go;
    const cfg = {
      rejeitado: { title: 'Rejeitar solicitação?', desc: 'O estoque reservado será devolvido e o vendedor poderá fazer uma nova solicitação no mês.', required: true, tone: 'danger', confirmText: 'Rejeitar solicitação' },
      cancelado: { title: 'Cancelar solicitação?', desc: 'O estoque reservado será devolvido e o vendedor será liberado para uma nova solicitação no mês. Não é possível desfazer.', required: false, tone: 'danger', confirmText: 'Cancelar solicitação' },
    }[to] || { title: `${ACTIONS[to]?.label || 'Alterar status'}?`, desc: `O status passará para “${STATUS[to].label}” e o vendedor verá a atualização na hora.`, required: false, tone: 'brand', confirmText: 'Confirmar' };
    const msg = await askMessage({ ...cfg, status: to });
    if (msg === null) return;
    try { await api.atualizarStatus(s.id, to, msg); toast(`Status atualizado: ${STATUS[to].label}.`); await done(); }
    catch (e) { toast(api.toAppError(e).message, 'error', 7000); await load().catch(() => {}); }
  });
  on(d.el, 'change', '#libCancel', async (_e, el) => {
    try { await api.liberarCancelamento(s.id, el.checked); toast(el.checked ? 'Cancelamento liberado ao vendedor.' : 'Autorização de cancelamento retirada.'); await done(); }
    catch (e) { toast(api.toAppError(e).message, 'error'); await load().catch(() => {}); }
  });
  on(d.el, 'click', '#addNota', async (_e, btn) => {
    const t = $('#nota', d.el).value.trim(); if (!t) return;
    await busy(btn, async () => { try { await api.adicionarNota(s.id, t); toast('Observação adicionada.'); await load(); } catch (e) { toast(api.toAppError(e).message, 'error'); } });
  });
  try { await load(); } catch (e) { d.setContent(html`<div class="drawer-body">${alertBox('danger', 'Erro ao carregar', api.toAppError(e).message)}</div>`); }
  return d;
}

/* =====================================================================
   PRODUTOS
   ===================================================================== */
export async function produtosView(root, ctx, query = {}) {
  let all = [], q = '', cat = '', filtro = query.baixo ? 'baixo' : 'todos';
  mount(root, html`<div class="page"><div class="page-head"><div><h1>Produtos</h1><p>Cadastre materiais, controle o estoque e a disponibilidade no catálogo.</p></div><button class="btn" id="novo">${ic('plus')}Novo produto</button></div>
    <div class="toolbar"><div class="input-wrap">${ic('search')}<input id="q" class="input" type="search" placeholder="Buscar produto…" aria-label="Buscar produto" autocomplete="off"></div>
      <select id="cat" class="select" aria-label="Categoria" style="width:auto"></select>
      <select id="filtro" class="select" aria-label="Filtro" style="width:auto"><option value="todos">Todos</option><option value="ativos" ${filtro === 'ativos' ? 'selected' : ''}>Somente ativos</option><option value="inativos">Somente inativos</option><option value="baixo" ${filtro === 'baixo' ? 'selected' : ''}>Estoque baixo</option></select></div>
    <div id="list" class="card">${skeletonBlock(260)}</div></div>`);
  function paint() {
    const cats = [...new Set(all.map((m) => m.categoria || 'Outros'))].sort();
    mount($('#cat', root), html`<option value="">Todas as categorias</option>${cats.map((c) => html`<option ${c === cat ? 'selected' : ''}>${c}</option>`)}`);
    const nq = norm(q);
    const rows = all.filter((m) => (!cat || (m.categoria || 'Outros') === cat) && (!nq || norm(m.nome + ' ' + (m.categoria || '')).includes(nq))
      && (filtro === 'todos' || (filtro === 'ativos' && m.ativo) || (filtro === 'inativos' && !m.ativo) || (filtro === 'baixo' && m.ativo && (Number(m.estoque) || 0) <= Number(m.estoque_minimo))));
    mount($('#list', root), rows.length ? html`<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Produto</th><th>Categoria</th><th class="right">Estoque</th><th class="right">Mínimo</th><th>Ativo</th><th></th></tr></thead><tbody>
      ${rows.map((m) => { const s = stockInfo(m); return html`<tr>
        <td class="cell-main"><div class="row"><div class="thumb-sm">${thumb(m)}</div><div><div class="strong">${m.nome}</div>${m.descricao ? html`<div class="xs muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.descricao}</div>` : ''}</div></div></td>
        <td data-label="Categoria" class="muted">${m.categoria || 'Outros'}</td>
        <td data-label="Estoque" class="right"><span class="badge ${s.tone}">${s.e} un.</span></td>
        <td data-label="Mínimo" class="right muted">${m.estoque_minimo}</td>
        <td data-label="Ativo"><label class="switch" title="${m.ativo ? 'Visível no catálogo' : 'Oculto no catálogo'}"><input type="checkbox" data-toggle="${m.id}" ${m.ativo ? 'checked' : ''} aria-label="Ativo: ${m.nome}"><span></span></label></td>
        <td class="cell-actions right"><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn sm secondary" data-stock="${m.id}">${ic('layers', 'sm')}Estoque</button><button class="btn sm secondary icon" data-edit="${m.id}" aria-label="Editar ${m.nome}" title="Editar">${ic('edit', 'sm')}</button><button class="btn sm danger-outline icon" data-del="${m.id}" aria-label="Excluir ${m.nome}" title="Excluir">${ic('trash', 'sm')}</button></div></td></tr>`; })}</tbody></table></div>
      <div class="small muted" style="padding:12px 20px;border-top:1px solid var(--line)">${rows.length} de ${all.length} produto(s)</div>`
      : emptyState('package', 'Nenhum produto encontrado', all.length ? 'Ajuste os filtros.' : 'Comece cadastrando o primeiro material.', all.length ? '' : html`<button class="btn" data-newempty>${ic('plus')}Novo produto</button>`));
  }
  async function load() { all = await api.listMateriais(); paint(); }
  const find = (id) => all.find((m) => String(m.id) === String(id));
  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; paint(); }, 150));
  on(root, 'change', '#cat', (_e, el) => { cat = el.value; paint(); });
  on(root, 'change', '#filtro', (_e, el) => { filtro = el.value; paint(); });
  on(root, 'click', '#novo', () => produtoModal(null, all, load));
  on(root, 'click', '[data-newempty]', () => produtoModal(null, all, load));
  on(root, 'click', '[data-edit]', (_e, el) => produtoModal(find(el.dataset.edit), all, load));
  on(root, 'click', '[data-stock]', (_e, el) => estoqueModal(find(el.dataset.stock), load));
  on(root, 'change', '[data-toggle]', async (_e, el) => {
    try { await api.atualizarProduto(el.dataset.toggle, { ativo: el.checked }); toast(el.checked ? 'Produto ativado no catálogo.' : 'Produto desativado (oculto para vendedores).'); await load(); }
    catch (e) { toast(api.toAppError(e).message, 'error'); await load().catch(() => {}); }
  });
  on(root, 'click', '[data-del]', async (_e, el) => {
    const m = find(el.dataset.del);
    const ok = await confirmDialog({ title: 'Excluir produto?', tone: 'danger', icon: 'trash', confirmText: 'Excluir produto', message: html`<p class="muted"><b>${m.nome}</b> será removido definitivamente. Se ele já foi usado em alguma solicitação, o sistema não permitirá a exclusão — nesse caso, desative-o.</p>` });
    if (!ok) return;
    try { await api.excluirProduto(m.id); toast('Produto excluído.'); await load(); } catch (e) { toast(api.toAppError(e).message, 'error', 8000); }
  });
  try { await load(); } catch (e) { mount($('#list', root), alertBox('danger', 'Erro ao carregar produtos', api.toAppError(e).message)); }
  return { refresh: () => load().catch(() => {}), destroy() {} };
}

function produtoModal(m, all, reload) {
  const novo = !m; let imagem = m?.imagem_url || '';
  const cats = [...new Set(all.map((x) => x.categoria).filter(Boolean))].sort();
  const mod = openModal(html`<form id="pf" novalidate><div class="modal-head"><h2>${novo ? 'Novo produto' : 'Editar produto'}</h2><button type="button" class="btn ghost icon sm" data-close aria-label="Fechar">${ic('x')}</button></div>
    <div class="modal-body">
      <div class="field"><label for="p-nome">Nome *</label><input id="p-nome" class="input" required maxlength="140" value="${m?.nome || ''}" autofocus></div>
      <div class="row wrap" style="align-items:flex-start"><div class="field grow" style="min-width:180px"><label for="p-cat">Categoria</label><input id="p-cat" class="input" list="cats" maxlength="80" value="${m?.categoria || ''}" placeholder="Ex.: Banners"><datalist id="cats">${cats.map((c) => html`<option value="${c}">`)}</datalist></div>
        <div class="field" style="width:130px"><label for="p-min">Estoque mínimo</label><input id="p-min" class="input" type="number" min="0" value="${m?.estoque_minimo ?? 5}"></div>
        ${novo ? html`<div class="field" style="width:130px"><label for="p-est">Estoque inicial</label><input id="p-est" class="input" type="number" min="0" value="0"></div>` : ''}</div>
      <div class="field"><label for="p-desc">Descrição</label><textarea id="p-desc" class="textarea" maxlength="600" placeholder="Medidas, material, observações de uso…">${m?.descricao || ''}</textarea></div>
      <div class="field"><span class="label">Imagem</span><div class="upload"><div class="preview" id="prev">${imagem ? html`<img src="${safeUrl(imagem)}" alt="">` : ic('image', 'lg')}</div>
        <div class="stack" style="gap:6px"><div class="row wrap" style="gap:8px"><label class="btn sm secondary" for="p-file" style="cursor:pointer">${ic('upload', 'sm')}Enviar imagem</label><input id="p-file" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only"><button type="button" class="btn sm ghost ${imagem ? '' : 'hidden'}" id="p-rm">Remover</button></div><span class="hint">JPG, PNG ou WebP · otimizada automaticamente.</span></div></div></div>
      ${novo ? '' : html`<div class="alert info" style="animation:none">${ic('info', 'lg')}<div class="small">O estoque atual é <b>${Number(m.estoque) || 0}</b>. Para alterá-lo use o botão <b>Estoque</b> na lista (fica registrado no histórico).</div></div>`}
      <label class="row" style="gap:12px;cursor:pointer"><span class="switch"><input type="checkbox" id="p-ativo" ${m?.ativo ?? true ? 'checked' : ''}><span></span></span><span class="small"><b>Ativo no catálogo</b><br><span class="muted">Produtos inativos ficam ocultos para os vendedores.</span></span></label>
      <div id="p-err" class="alert danger hidden" style="animation:none"></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn" id="p-save">${novo ? 'Cadastrar produto' : 'Salvar alterações'}</button></div></form>`, { wide: true });
  const paintPrev = () => { mount($('#prev', mod.el), imagem ? html`<img src="${safeUrl(imagem)}" alt="">` : ic('image', 'lg')); $('#p-rm', mod.el).classList.toggle('hidden', !imagem); };
  const showErr = (t) => { const e = $('#p-err', mod.el); e.textContent = t; e.classList.remove('hidden'); };
  $('#p-file', mod.el).addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const lbl = $('label[for="p-file"]', mod.el); const old = lbl.innerHTML; lbl.innerHTML = '<span class="spinner"></span> Enviando…';
    try { imagem = await api.uploadImagemProduto(f); paintPrev(); } catch (e) { showErr(api.toAppError(e).message); } finally { lbl.innerHTML = old; ev.target.value = ''; }
  });
  $('#p-rm', mod.el).addEventListener('click', () => { imagem = ''; paintPrev(); });
  $('#pf', mod.el).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = $('#p-nome', mod.el).value.trim();
    if (!nome) { showErr('Informe o nome do produto.'); $('#p-nome', mod.el).focus(); return; }
    const payload = { nome, categoria: $('#p-cat', mod.el).value.trim() || null, descricao: $('#p-desc', mod.el).value.trim() || null,
      imagem_url: imagem || null, ativo: $('#p-ativo', mod.el).checked, estoque_minimo: Math.max(0, parseInt($('#p-min', mod.el).value, 10) || 0) };
    if (novo) payload.estoque = Math.max(0, parseInt($('#p-est', mod.el).value, 10) || 0);
    await busy($('#p-save', mod.el), async () => {
      try { novo ? await api.criarProduto(payload) : await api.atualizarProduto(m.id, payload); toast(novo ? 'Produto cadastrado.' : 'Produto atualizado.'); mod.close(); await reload(); }
      catch (e) { showErr(api.toAppError(e).message); }
    });
  });
}

async function estoqueModal(m, reload) {
  let novo = Number(m.estoque) || 0;
  const TIPOS = { reserva: 'Reserva (solicitação)', devolucao: 'Devolução', ajuste: 'Ajuste manual', cadastro: 'Estoque inicial' };
  const mod = openModal(html`<div class="modal-head"><div><h2>Estoque — ${m.nome}</h2><p class="muted small" style="margin-top:2px">Atual: <b>${Number(m.estoque) || 0}</b> un. · todo ajuste fica registrado.</p></div><button class="btn ghost icon sm" data-close aria-label="Fechar">${ic('x')}</button></div>
    <div class="modal-body"><div class="field"><label for="e-novo">Novo estoque</label><div class="row"><div class="stepper"><button data-d="-10" type="button">−10</button><button data-d="-1" type="button" aria-label="Menos 1">${ic('minus', 'sm')}</button><input id="e-novo" type="number" min="0" value="${novo}" style="width:80px"><button data-d="1" type="button" aria-label="Mais 1">${ic('plus', 'sm')}</button><button data-d="10" type="button">+10</button></div></div></div>
      <div class="field"><label for="e-mot">Motivo (opcional)</label><input id="e-mot" class="input" maxlength="200" placeholder="Ex.: entrada NF 1234, contagem de inventário"></div>
      <div id="e-err" class="alert danger hidden" style="animation:none"></div>
      <div><div class="section-title">Últimas movimentações</div><div id="mov" class="small muted">Carregando…</div></div></div>
    <div class="modal-foot"><button class="btn secondary" data-close>Cancelar</button><button class="btn" id="e-save">Salvar estoque</button></div>`);
  const inp = $('#e-novo', mod.el);
  on(mod.el, 'click', '[data-d]', (_e, b) => { inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + Number(b.dataset.d)); });
  $('#e-save', mod.el).addEventListener('click', async (ev) => {
    await busy(ev.currentTarget, async () => {
      try { await api.definirEstoque(m.id, Math.max(0, parseInt(inp.value, 10) || 0), $('#e-mot', mod.el).value); toast('Estoque atualizado.'); mod.close(); await reload(); }
      catch (e) { const el = $('#e-err', mod.el); el.textContent = api.toAppError(e).message; el.classList.remove('hidden'); }
    });
  });
  try {
    const mov = await api.listMovimentos(m.id);
    mount($('#mov', mod.el), mov.length ? html`<div>${mov.map((x) => html`<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><div><span class="strong" style="color:${x.delta > 0 ? 'var(--green)' : 'var(--red)'}">${x.delta > 0 ? '+' : ''}${x.delta}</span> <span class="muted">${TIPOS[x.tipo] || x.tipo}${x.motivo ? ' · ' + x.motivo : ''}</span></div><span class="xs muted nowrap">${fmtDateTime(x.criado_em)}</span></div>`)}</div>` : html`<span>Sem movimentações.</span>`);
  } catch { mount($('#mov', mod.el), html`<span>Não foi possível carregar.</span>`); }
}

/* =====================================================================
   VENDEDORES
   ===================================================================== */
const gerarSenha = () => { // 12 caracteres sem símbolos ambíguos (0/O, 1/l/I)
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const b = new Uint32Array(12); crypto.getRandomValues(b);
  return [...b].map((n) => A[n % A.length]).join('');
};
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); toast('Copiado!'); } catch { toast('Não foi possível copiar automaticamente. Selecione e copie o texto.', 'error'); }
}
const senhaField = (id, label = 'Senha') => html`<div class="field"><label for="${id}">${label} * <span class="hint">(mínimo 8 caracteres)</span></label>
  <div class="row" style="gap:8px"><div class="input-wrap grow">${ic('lock')}<input id="${id}" class="input" type="text" autocomplete="new-password" minlength="8" maxlength="72" required spellcheck="false" style="padding-right:12px"></div>
  <button type="button" class="btn secondary" data-gen="${id}">${ic('refresh', 'sm')}Gerar</button></div></div>`;
const credenciais = (nome, email, senha, titulo) => html`<div class="alert success" style="animation:none">${ic('check-circle', 'lg')}<div class="grow"><div class="alert-title">${titulo}</div>
  <div class="small">Anote ou copie agora: <b>a senha não será mostrada novamente.</b></div></div></div>
  <div class="card pad" style="background:var(--surface-2)"><dl class="kv"><dt>Nome</dt><dd>${nome}</dd><dt>E-mail</dt><dd>${email}</dd><dt>Senha</dt><dd><b style="font-family:ui-monospace,monospace;letter-spacing:.04em">${senha}</b></dd></dl></div>`;

function vendedorFormModal(v, reload) {
  const novo = !v; let feito = null;
  const mod = openModal(html`<form id="vf" novalidate><div class="modal-head"><div><h2>${novo ? 'Novo vendedor' : 'Editar vendedor'}</h2>
      <p class="muted small" style="margin-top:4px">${novo ? 'O vendedor poderá entrar na loja com este e-mail e senha.' : 'Altere o nome e/ou o e-mail de acesso.'}</p></div><button type="button" class="btn ghost icon sm" data-close aria-label="Fechar">${ic('x')}</button></div>
    <div class="modal-body" id="vbody">
      <div class="field"><label for="v-nome">Nome *</label><input id="v-nome" class="input" maxlength="120" required value="${v?.nome || ''}" autofocus></div>
      <div class="field"><label for="v-email">E-mail *</label><div class="input-wrap">${ic('mail')}<input id="v-email" class="input" type="email" maxlength="254" required autocomplete="off" value="${v?.email || ''}" placeholder="vendedor@empresa.com.br"></div></div>
      ${novo ? senhaField('v-senha') : ''}
      <div id="v-err" class="alert danger hidden" role="alert" style="animation:none"></div></div>
    <div class="modal-foot" id="vfoot"><button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn" id="v-save">${novo ? 'Criar vendedor' : 'Salvar'}</button></div></form>`);
  const err = (t) => { const e = $('#v-err', mod.el); e.textContent = t; e.classList.toggle('hidden', !t); };
  if (novo) { $('#v-senha', mod.el).value = gerarSenha(); }
  on(mod.el, 'click', '[data-gen]', (_e, b) => { $('#' + b.dataset.gen, mod.el).value = gerarSenha(); });
  $('#vf', mod.el).addEventListener('submit', async (ev) => {
    ev.preventDefault(); if (feito) return; err('');
    const nome = $('#v-nome', mod.el).value.trim(), email = $('#v-email', mod.el).value.trim().toLowerCase(), senha = novo ? $('#v-senha', mod.el).value : '';
    if (!nome) return err('Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('Informe um e-mail válido.');
    if (novo && senha.length < 8) return err('A senha deve ter pelo menos 8 caracteres.');
    await busy($('#v-save', mod.el), async () => {
      try {
        if (novo) {
          await api.usuarios('criar', { nome, email, senha }); feito = true;
          mount($('#vbody', mod.el), credenciais(nome, email, senha, 'Vendedor criado com sucesso!'));
          mount($('#vfoot', mod.el), html`<button type="button" class="btn secondary" data-copy>${ic('copy', 'sm')}Copiar acesso</button><button type="button" class="btn" data-close>Concluir</button>`);
          on(mod.el, 'click', '[data-copy]', () => copiar(`Loja MPDV Sakamoto\nE-mail: ${email}\nSenha: ${senha}`));
        } else {
          if (nome !== (v.nome || '')) await api.atualizarVendedor(v.id, { nome });
          if (email !== (v.email || '').toLowerCase()) await api.usuarios('email', { id: v.id, email });
          toast('Dados atualizados.'); mod.close();
        }
        await reload();
      } catch (e) { err(api.toAppError(e).message); }
    });
  });
}

function senhaModal(v) {
  let feito = null;
  const mod = openModal(html`<form id="sf" novalidate><div class="modal-head"><div><h2>Redefinir senha</h2><p class="muted small" style="margin-top:4px">${v.nome || v.email} · ${v.email}</p></div><button type="button" class="btn ghost icon sm" data-close aria-label="Fechar">${ic('x')}</button></div>
    <div class="modal-body" id="sbody">${senhaField('s-senha', 'Nova senha')}<div id="s-err" class="alert danger hidden" role="alert" style="animation:none"></div></div>
    <div class="modal-foot" id="sfoot"><button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn" id="s-save">${ic('key', 'sm')}Redefinir senha</button></div></form>`);
  $('#s-senha', mod.el).value = gerarSenha();
  on(mod.el, 'click', '[data-gen]', (_e, b) => { $('#' + b.dataset.gen, mod.el).value = gerarSenha(); });
  $('#sf', mod.el).addEventListener('submit', async (ev) => {
    ev.preventDefault(); if (feito) return; const er = $('#s-err', mod.el); er.classList.add('hidden');
    const senha = $('#s-senha', mod.el).value;
    if (senha.length < 8) { er.textContent = 'A senha deve ter pelo menos 8 caracteres.'; er.classList.remove('hidden'); return; }
    await busy($('#s-save', mod.el), async () => {
      try {
        await api.usuarios('senha', { id: v.id, senha }); feito = true;
        mount($('#sbody', mod.el), credenciais(v.nome || '—', v.email, senha, 'Senha redefinida!'));
        mount($('#sfoot', mod.el), html`<button type="button" class="btn secondary" data-copy>${ic('copy', 'sm')}Copiar acesso</button><button type="button" class="btn" data-close>Concluir</button>`);
        on(mod.el, 'click', '[data-copy]', () => copiar(`Loja MPDV Sakamoto\nE-mail: ${v.email}\nNova senha: ${senha}`));
      } catch (e) { er.textContent = api.toAppError(e).message; er.classList.remove('hidden'); }
    });
  });
}

export async function vendedoresView(root, ctx) {
  let list = [], q = '';
  mount(root, html`<div class="page"><div class="page-head"><div><h1>Vendedores</h1><p>Cadastre vendedores, redefina senhas, consulte o histórico individual e ative ou desative acessos.</p></div><button class="btn" id="novo">${ic('user-plus')}Novo vendedor</button></div>
    <div class="toolbar"><div class="input-wrap">${ic('search')}<input id="q" class="input" type="search" placeholder="Buscar vendedor…" aria-label="Buscar vendedor" autocomplete="off"></div></div>
    <div id="list" class="card">${skeletonBlock(220)}</div></div>`);
  function paint() {
    const nq = norm(q);
    const rows = list.filter((v) => !nq || norm((v.nome || '') + ' ' + (v.email || '')).includes(nq));
    mount($('#list', root), rows.length ? html`<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Vendedor</th><th>Pedido do mês</th><th class="right">Solicitações</th><th>Última</th><th>Ativo</th><th></th></tr></thead><tbody>
      ${rows.map((v) => html`<tr class="clickable" data-open="${v.id}">
        <td class="cell-main"><div class="row"><div class="avatar">${initials(v.nome || v.email)}</div><div><div class="strong">${v.nome || '—'}</div><div class="xs muted">${v.email}</div></div></div></td>
        <td data-label="Pedido do mês">${v.status_mes ? statusBadge(v.status_mes) : html`<span class="muted">Sem pedido</span>`}</td>
        <td data-label="Solicitações" class="right">${v.total_solicitacoes}</td>
        <td data-label="Última" class="muted nowrap">${v.ultima_solicitacao ? fmtDate(v.ultima_solicitacao) : '—'}</td>
        <td data-label="Ativo"><label class="switch"><input type="checkbox" data-toggle="${v.id}" ${v.ativo ? 'checked' : ''} aria-label="Ativo: ${v.nome || v.email}"><span></span></label></td>
        <td class="cell-actions right"><button class="btn sm secondary">Gerenciar ${ic('chevron-right', 'sm')}</button></td></tr>`)}</tbody></table></div>`
      : emptyState('users', 'Nenhum vendedor encontrado', list.length ? 'Ajuste a busca.' : 'Clique em “Novo vendedor” para cadastrar o primeiro.', list.length ? '' : html`<button class="btn" data-newempty>${ic('user-plus')}Novo vendedor</button>`));
  }
  async function load() { list = await api.listarVendedores(); paint(); }
  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; paint(); }, 150));
  on(root, 'click', '#novo', () => vendedorFormModal(null, load));
  on(root, 'click', '[data-newempty]', () => vendedorFormModal(null, load));
  on(root, 'click', '[data-toggle]', (e) => e.stopPropagation());
  on(root, 'change', '[data-toggle]', async (_e, el) => {
    const v = list.find((x) => x.id === el.dataset.toggle);
    if (!el.checked) {
      const ok = await confirmDialog({ title: 'Desativar vendedor?', tone: 'warn', icon: 'alert', confirmText: 'Desativar', message: html`<p class="muted"><b>${v.nome || v.email}</b> perderá o acesso à loja imediatamente. Os pedidos dele continuam no sistema.</p>` });
      if (!ok) { el.checked = true; return; }
    }
    try { await api.atualizarVendedor(el.dataset.toggle, { ativo: el.checked }); toast(el.checked ? 'Vendedor ativado.' : 'Vendedor desativado.'); await load(); }
    catch (e) { toast(api.toAppError(e).message, 'error'); await load().catch(() => {}); }
  });
  on(root, 'click', '[data-open]', (e, el) => { if (e.target.closest('.switch')) return; vendedorDrawer(list.find((x) => x.id === el.dataset.open), load); });
  try { await load(); } catch (e) { mount($('#list', root), alertBox('danger', 'Erro ao carregar vendedores', api.toAppError(e).message)); }
  return { refresh: () => load().catch(() => {}), destroy() {} };
}

async function vendedorDrawer(v, reload) {
  const d = openModal(html`<div class="drawer-head"><div class="row"><div class="avatar">${initials(v.nome || v.email)}</div><div><h2>${v.nome || '—'}</h2><p class="small muted">${v.email}</p></div></div><button class="btn ghost icon" data-close aria-label="Fechar">${ic('x')}</button></div>
    <div class="drawer-body"><div class="row wrap"><span class="badge ${v.ativo ? 'green' : 'red'}">${v.ativo ? 'Ativo' : 'Desativado'}</span><span class="small muted">${v.total_solicitacoes} solicitação(ões) · cadastrado em ${fmtDate(v.criado_em)}</span></div>
    <div class="row wrap"><button class="btn secondary sm" data-edit>${ic('edit', 'sm')}Editar dados</button><button class="btn secondary sm" data-pass>${ic('key', 'sm')}Redefinir senha</button></div>
    <section><div class="section-title">Histórico de solicitações</div><div id="h" class="card">${skeletonBlock(120)}</div></section></div>`, { drawer: true });
  on(d.el, 'click', '[data-edit]', () => { d.close(); vendedorFormModal(v, reload); });
  on(d.el, 'click', '[data-pass]', () => senhaModal(v));
  try {
    const sols = await api.solicitacoesDoVendedor(v.id);
    mount($('#h', d.el), sols.length ? html`${sols.map((s) => html`<div class="order-card" data-sol="${s.id}"><div><div class="row wrap" style="gap:10px"><span class="order-num">${numeroFmt(s.numero)}</span>${statusBadge(s.status)}</div><div class="small muted" style="margin-top:4px">${fmtDateTime(s.criado_em)} · ${totalItens(s)} item(ns) · ${fmtMes(s.mes_referencia)}</div></div><span class="muted">${ic('chevron-right')}</span></div>`)}` : emptyState('clipboard', 'Sem solicitações', 'Este vendedor ainda não fez pedidos.'));
    on(d.el, 'click', '[data-sol]', (_e, el) => openPedidoDrawer(el.dataset.sol));
  } catch (e) { mount($('#h', d.el), alertBox('danger', 'Erro', api.toAppError(e).message)); }
}
