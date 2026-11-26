// Carrinho do vendedor (somente conveniência de interface; o servidor revalida tudo).
let uid = null;
let items = new Map(); // id(string) -> quantidade
const listeners = new Set();
const key = () => `mpdv:cart:${uid}`;

function persist() { try { localStorage.setItem(key(), JSON.stringify([...items])); } catch { /* storage indisponível */ } }
function emit() { listeners.forEach((f) => f()); }

export const cart = {
  load(userId) {
    uid = userId; items = new Map();
    try { const raw = JSON.parse(localStorage.getItem(key()) || '[]'); if (Array.isArray(raw)) items = new Map(raw.filter(([k, q]) => k && q > 0)); } catch { /* ignora */ }
    emit();
  },
  get: (id) => items.get(String(id)) || 0,
  set(id, qty) { qty = Math.max(0, Math.floor(Number(qty) || 0)); if (qty) items.set(String(id), qty); else items.delete(String(id)); persist(); emit(); },
  add(id, n = 1) { cart.set(id, cart.get(id) + n); },
  remove(id) { cart.set(id, 0); },
  clear() { items = new Map(); persist(); emit(); },
  entries: () => [...items],
  count: () => [...items.values()].reduce((a, b) => a + b, 0),
  lines: () => items.size,
  /** Ajusta às quantidades reais do catálogo (remove inexistentes/inativos, limita ao estoque). */
  reconcile(materiais) {
    const map = new Map(materiais.map((m) => [String(m.id), m]));
    let changed = false;
    for (const [id, q] of [...items]) {
      const m = map.get(id);
      const max = m && m.ativo ? Math.max(0, Number(m.estoque) || 0) : 0;
      if (max === 0) { items.delete(id); changed = true; } else if (q > max) { items.set(id, max); changed = true; }
    }
    if (changed) { persist(); emit(); }
    return changed;
  },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
};
