import { html, ic, fmtShort, fmtDateTime, safeUrl, pad } from '../lib/dom.js';
import { STATUS, STATUS_ORDER } from '../api.js';

export const statusBadge = (s) => {
  const m = STATUS[s] || { label: s, tone: '', icon: 'info' };
  return html`<span class="badge ${m.tone}">${ic(m.icon)}${m.label}</span>`;
};
export const numeroFmt = (n) => '#' + pad(n);

export function alertBox(tone, title, body, extra) {
  const icoName = { warn: 'alert', danger: 'ban', info: 'info', success: 'check-circle' }[tone] || 'info';
  return html`<div class="alert ${tone}" role="${tone === 'danger' ? 'alert' : 'status'}">${ic(icoName, 'lg')}<div class="grow">${title ? html`<div class="alert-title">${title}</div>` : ''}<div>${body}</div>${extra || ''}</div></div>`;
}
export const emptyState = (icon, title, text, action) => html`<div class="empty">${ic(icon)}<h3>${title}</h3><p>${text || ''}</p>${action ? html`<div style="margin-top:16px">${action}</div>` : ''}</div>`;
export const skeletonGrid = (n = 8) => html`<div class="products">${Array.from({ length: n }, () => html`<div class="skeleton" style="height:300px"></div>`)}</div>`;
export const skeletonBlock = (h = 220) => html`<div class="skeleton" style="height:${h}px"></div>`;

export function thumb(m, cls = 'thumb', fallbackIcon = 'package') {
  const url = safeUrl(m.imagem_url);
  return url ? html`<img src="${url}" alt="${m.nome}" loading="lazy" decoding="async">` : ic(fallbackIcon);
}
export function stockInfo(m) {
  const e = Math.max(0, Number(m.estoque) || 0), min = Number(m.estoque_minimo ?? 5);
  if (e <= 0) return { e, cls: 'stock-out', label: 'Esgotado', tone: 'red' };
  if (e <= min) return { e, cls: 'stock-low', label: `Últimas ${e} un.`, tone: 'amber' };
  return { e, cls: 'stock-ok', label: `${e} em estoque`, tone: 'green' };
}

/* ---------- Linha do tempo (6 etapas) ---------- */
const STEPS = [
  { key: 'enviada', label: 'Solicitação enviada', icon: 'check' },
  { key: 'aguardando_analise', label: 'Em análise', icon: 'clock' },
  { key: 'aprovado', label: 'Aprovada', icon: 'check-circle' },
  { key: 'em_separacao', label: 'Em separação', icon: 'package' },
  { key: 'em_transporte', label: 'Em transporte', icon: 'truck' },
  { key: 'entregue', label: 'Entregue', icon: 'check-circle' },
];
export function timeline(s) {
  const hist = [...(s.solicitacao_historico_mpdv || [])].sort((a, b) => a.id - b.id);
  const when = (st) => hist.find((h) => h.status_novo === st && h.evento !== 'cancelamento')?.criado_em;
  const encerrado = s.status === 'cancelado' || s.status === 'rejeitado';
  let reached;
  if (encerrado) {
    reached = 1;
    for (const h of hist) { const i = STATUS_ORDER.indexOf(h.status_novo); if (i >= 0) reached = Math.max(reached, i + 1); }
  } else reached = STATUS_ORDER.indexOf(s.status) + 1; // 1..5 (índice do passo atual)
  return html`<div class="timeline" role="list" aria-label="Andamento da solicitação">${STEPS.map((st, i) => {
    let cls = 'pending';
    if (i < reached) cls = 'done';
    else if (i === reached) cls = encerrado ? 'stopped' : 'current';
    if (!encerrado && s.status === 'entregue') cls = 'done';
    const t = st.key === 'enviada' ? (hist[0]?.criado_em || s.criado_em) : when(st.key);
    return html`<div class="tl-step ${cls}" role="listitem" ${cls === 'current' ? 'aria-current="step"' : ''}>
      <div class="tl-dot">${ic(cls === 'done' ? 'check' : st.icon)}</div>
      <div class="tl-text"><div class="tl-label">${st.label}</div>${t && cls !== 'pending' && cls !== 'stopped' ? html`<div class="tl-time">${fmtShort(t)}</div>` : ''}</div></div>`;
  })}</div>`;
}

/** Bloco de cancelamento/rejeição. */
export function encerramentoBox(s, quem = 'vendedor') {
  if (s.status !== 'cancelado' && s.status !== 'rejeitado') return '';
  const hist = [...(s.solicitacao_historico_mpdv || [])].sort((a, b) => b.id - a.id);
  const ev = hist.find((h) => h.status_novo === s.status);
  const porQuem = s.cancelado_por_papel === 'marketing' || ev?.usuario_papel === 'marketing' ? 'pelo Marketing' : 'por você';
  const quemTxt = quem === 'admin' ? (s.cancelado_por_papel === 'vendedor' ? 'pelo vendedor' : 'pelo Marketing') : porQuem;
  const quando = s.cancelado_em || ev?.criado_em;
  const motivo = s.motivo_cancelamento || ev?.mensagem;
  return alertBox('danger', s.status === 'cancelado' ? `Solicitação cancelada ${quemTxt}` : 'Solicitação rejeitada pelo Marketing',
    html`${quando ? html`Em ${fmtDateTime(quando)}.` : ''}${motivo ? html` <b>Motivo:</b> ${motivo}` : ''} O estoque dos itens foi liberado e ${quem === 'vendedor' ? 'você já pode' : 'o vendedor já pode'} fazer uma nova solicitação neste mês.`);
}

/** Mensagens/histórico (visível ao vendedor). */
export function historicoList(s) {
  const hist = [...(s.solicitacao_historico_mpdv || [])].sort((a, b) => b.id - a.id);
  if (!hist.length) return html`<p class="muted small">Sem atualizações.</p>`;
  return html`<ul class="history">${hist.map((h) => html`<li>
    <div class="row wrap" style="gap:8px">${h.status_novo ? statusBadge(h.status_novo) : ''}<span class="xs muted">${fmtDateTime(h.criado_em)} · ${h.usuario_papel === 'marketing' ? 'Marketing' : 'Vendedor'}</span></div>
    ${h.mensagem ? html`<p class="small" style="margin-top:4px">${h.mensagem}</p>` : ''}</li>`)}</ul>`;
}

export function itensTable(s) {
  const its = s.solicitacao_itens_mpdv || [];
  return html`<div class="card"><table class="table"><thead><tr><th>Produto</th><th class="right">Qtd.</th></tr></thead><tbody>${its.map((i) => html`<tr><td><div class="strong">${i.nome_snapshot}</div><div class="xs muted">${i.categoria_snapshot || ''}</div></td><td class="right strong">${i.quantidade}</td></tr>`)}</tbody></table></div>`;
}
export const totalItens = (s) => (s.solicitacao_itens_mpdv || []).reduce((a, i) => a + (i.quantidade || 0), 0);
