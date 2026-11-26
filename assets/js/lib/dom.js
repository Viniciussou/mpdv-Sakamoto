// Utilidades de DOM: templating seguro, toasts, modais, formatação.
import { icon } from './icons.js';

/* ---------- Templating com escape automático ----------
   html`<b>${valor}</b>` escapa tudo por padrão. Só `raw()` e resultados de html`` são confiáveis. */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
function part(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const ic = (name, size) => raw(icon(name, size));
export function mount(el, tpl) { el.innerHTML = tpl instanceof Safe ? tpl.s : esc(tpl); }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Só permite http(s) em URLs vindas do banco (imagens). */
export function safeUrl(u) {
  if (!u || !String(u).trim()) return '';
  try { const x = new URL(String(u || ''), location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}

/** Delegação de eventos: on(root,'click','[data-action]', (ev, el) => ...) */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (ev) => {
    const el = ev.target.closest?.(selector);
    if (el && root.contains(el)) handler(ev, el);
  });
}

/* ---------- Formatação ---------- */
const TZ = 'America/Sao_Paulo';
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ }) : '—';
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtShort = (d) => d ? new Date(d).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export function fmtMes(iso) { // '2026-11-01' => 'novembro de 2026'
  if (!iso) return '—';
  const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
export const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');
export const pad = (n, l = 4) => String(n ?? '').padStart(l, '0');
export const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- Toasts ---------- */
let toastBox;
export function toast(msg, type = 'success', ms = 4500) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'info' ? 'bell' : 'check-circle')}<div class="grow">${esc(msg)}</div><button aria-label="Fechar">${icon('x', 'sm')}</button>`;
  const close = () => { el.remove(); };
  el.querySelector('button').addEventListener('click', close);
  toastBox.append(el);
  if (ms) setTimeout(close, ms);
}

/* ---------- Modal / Drawer ---------- */
let openCount = 0;
function lockScroll(lock) { openCount += lock ? 1 : -1; document.body.style.overflow = openCount > 0 ? 'hidden' : ''; }

/** Abre um modal. Retorna { el, close }. `content` é Safe (html``). */
export function openModal(content, { wide = false, drawer = false, onClose } = {}) {
  const prevFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay' + (drawer ? ' drawer-overlay' : '');
  overlay.innerHTML = drawer
    ? `<div class="drawer" role="dialog" aria-modal="true">${content.s}</div>`
    : `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${content.s}</div>`;
  document.body.append(overlay);
  lockScroll(true);
  const box = overlay.firstElementChild;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove(); lockScroll(false); prevFocus?.focus?.(); onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && overlay === [...document.querySelectorAll('.overlay')].pop()) close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  on(box, 'click', '[data-close]', close);
  (box.querySelector('[autofocus]') || box.querySelector('input,select,textarea,button:not([data-close])'))?.focus();
  return { el: box, close, setContent(c) { box.innerHTML = c.s; } };
}

/** Confirmação elegante. Retorna Promise<boolean>. */
export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Voltar', tone = 'brand', icon: ico = 'info', extra }) {
  return new Promise((resolve) => {
    const toneCls = tone === 'danger' ? 'tone-red' : tone === 'warn' ? 'tone-amber' : 'tone-brand';
    let result = false;
    const m = openModal(html`
      <div class="modal-head"><div class="row" style="align-items:flex-start;gap:14px"><div class="modal-ico ${toneCls}">${ic(ico, 'lg')}</div><div><h2>${title}</h2></div></div></div>
      <div class="modal-body">${typeof message === 'string' ? html`<p class="muted" style="white-space:pre-line">${message}</p>` : message}${extra || ''}</div>
      <div class="modal-foot"><button class="btn secondary" data-close>${cancelText}</button><button class="btn ${tone === 'danger' ? 'danger' : ''}" data-ok autofocus>${confirmText}</button></div>`,
      { onClose: () => resolve(result) });
    $('[data-ok]', m.el).addEventListener('click', () => { result = true; m.close(); });
  });
}

/** Mostra spinner no botão enquanto roda a função async. */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
