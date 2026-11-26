// Camada de acesso ao Supabase. Toda regra de negócio vive no banco (RPCs + RLS);
// aqui apenas chamamos e traduzimos erros.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  document.getElementById('app').innerHTML = '<div style="padding:32px;font-family:sans-serif;max-width:520px;margin:10vh auto"><h2>Configuração ausente</h2><p>As variáveis do Supabase não foram definidas no deploy. Defina-as na Vercel e faça um novo deploy.</p></div>';
  throw new Error('SUPABASE_URL/SUPABASE_KEY ausentes (config.js não foi gerado pelo build).');
}
if (!window.supabase) throw new Error('Biblioteca do Supabase não carregou. Verifique a conexão com a internet.');
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
});

/* ---------- Status ---------- */
export const STATUS = {
  aguardando_analise: { label: 'Aguardando análise', tone: 'amber', icon: 'clock' },
  aprovado: { label: 'Aprovado', tone: 'blue', icon: 'check-circle' },
  em_separacao: { label: 'Em separação', tone: 'violet', icon: 'package' },
  em_transporte: { label: 'Em transporte', tone: 'indigo', icon: 'truck' },
  entregue: { label: 'Entregue', tone: 'green', icon: 'check-circle' },
  cancelado: { label: 'Cancelado', tone: 'red', icon: 'ban' },
  rejeitado: { label: 'Rejeitado', tone: 'red', icon: 'x' },
};
export const STATUS_ORDER = ['aguardando_analise', 'aprovado', 'em_separacao', 'em_transporte', 'entregue'];
export const ENCERRADOS = ['cancelado', 'rejeitado'];
export const MSG = {
  AVISO_MENSAL: '⚠️ Atenção! Cada vendedor pode realizar apenas uma solicitação por mês. Caso precise realizar outra solicitação, será necessário cancelar a anterior, desde que ela ainda não esteja em processo de entrega.',
  JA_TEM: 'Você já possui uma solicitação registrada neste mês. Para realizar uma nova solicitação, será necessário cancelar o pedido atual, caso ele ainda permita cancelamento.',
  EM_ENTREGA: 'Seu pedido já está em processo de entrega e não pode mais ser cancelado. Acompanhe o andamento diretamente por aqui.',
};
/** Regra de cancelamento (espelho da regra do banco, só para a interface; o servidor é quem decide). */
export function vendedorPodeCancelar(s) {
  if (!s) return false;
  if (s.status === 'aguardando_analise' || s.status === 'aprovado') return true;
  return s.status === 'em_separacao' && s.cancelamento_liberado === true;
}
/** Transições que o Marketing pode fazer (espelho de mpdv_transicao_permitida). */
export const TRANSICOES = {
  aguardando_analise: ['aprovado', 'rejeitado', 'cancelado'],
  aprovado: ['em_separacao', 'aguardando_analise', 'cancelado'],
  em_separacao: ['em_transporte', 'aprovado', 'cancelado'],
  em_transporte: ['entregue', 'em_separacao', 'cancelado'],
};

/* ---------- Erros ---------- */
export class AppError extends Error { constructor(message, code) { super(message); this.code = code; } }
export function toAppError(e) {
  if (e instanceof AppError) return e;
  const msg = String(e?.message || e || '');
  const code = e?.details && /^[A-Z_]+$/.test(e.details) ? e.details : e?.code;
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return new AppError('Sem conexão com o servidor. Verifique sua internet e tente novamente.', 'REDE');
  if (e?.code === 'PGRST301' || /jwt expired/i.test(msg)) return new AppError('Sua sessão expirou. Entre novamente.', 'NAO_AUTENTICADO');
  if (e?.code === '23503') return new AppError('Este produto já foi usado em solicitações e não pode ser excluído. Desative-o em vez de excluir.', 'FK');
  if (e?.code === '42501' || code === 'SEM_PERMISSAO') return new AppError('Você não tem permissão para realizar esta ação.', 'SEM_PERMISSAO');
  if (/invalid login credentials/i.test(msg)) return new AppError('E-mail ou senha incorretos.', 'LOGIN');
  if (/email not confirmed/i.test(msg)) return new AppError('E-mail ainda não confirmado. Verifique sua caixa de entrada.', 'LOGIN');
  if (/rate limit|too many/i.test(msg)) return new AppError('Muitas tentativas. Aguarde um instante e tente novamente.', 'LIMITE');
  if (e?.code === 'P0001') return new AppError(msg, code); // mensagens de negócio já vêm em português do banco
  return new AppError(msg || 'Ocorreu um erro inesperado.', code);
}
async function call(promise) {
  let r;
  try { r = await promise; } catch (e) { throw toAppError(e); }
  if (r.error) throw toAppError(r.error);
  return r.data;
}
const rpc = (fn, args) => call(sb.rpc(fn, args));

/* ---------- Auth ---------- */
export const auth = {
  getSession: async () => (await sb.auth.getSession()).data.session,
  signIn: (email, password) => call(sb.auth.signInWithPassword({ email, password })),
  signOut: () => sb.auth.signOut(),
  reset: (email) => call(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })),
  setPassword: (password) => call(sb.auth.updateUser({ password })),
  onChange: (cb) => sb.auth.onAuthStateChange((event, session) => setTimeout(() => cb(event, session), 0)),
};
export const getPerfil = (uid) => call(sb.from('perfis_mpdv').select('id,nome,email,papel,ativo').eq('id', uid).maybeSingle());

/* ---------- Catálogo ---------- */
export const listMateriais = () => call(sb.from('materiais_mpdv')
  .select('id,nome,categoria,descricao,imagem_url,estoque,estoque_minimo,ativo').order('nome'));

/* ---------- Vendedor ---------- */
export const estadoMes = () => rpc('mpdv_estado_mes');
export const criarSolicitacao = (itens, observacao) => rpc('mpdv_criar_solicitacao', { p_itens: itens, p_observacao: observacao || null });
export const cancelarSolicitacao = (id, motivo) => rpc('mpdv_cancelar_solicitacao', { p_id: id, p_motivo: motivo || null });

const SOL_LIST = 'id,numero,vendedor_id,mes_referencia,status,observacao_vendedor,cancelamento_liberado,cancelado_em,cancelado_por_papel,motivo_cancelamento,criado_em,atualizado_em,solicitacao_itens_mpdv(quantidade)';
const SOL_FULL = '*,vendedor:perfis_mpdv!vendedor_id(id,nome,email),solicitacao_itens_mpdv(id,material_id,nome_snapshot,categoria_snapshot,quantidade),solicitacao_historico_mpdv(id,evento,status_anterior,status_novo,mensagem,usuario_papel,criado_em)';
export const listMinhasSolicitacoes = () => call(sb.from('solicitacoes_mpdv').select(SOL_LIST).order('criado_em', { ascending: false }).limit(100));
export const getSolicitacao = (id) => call(sb.from('solicitacoes_mpdv').select(SOL_FULL).eq('id', id).maybeSingle());

/* ---------- Marketing ---------- */
export const dashboard = (mes) => rpc('mpdv_dashboard', { p_mes: mes || null });
export const listSolicitacoesAdmin = () => call(sb.from('solicitacoes_mpdv')
  .select(SOL_LIST + ',vendedor:perfis_mpdv!vendedor_id(id,nome,email)').order('criado_em', { ascending: false }).limit(500));
export const solicitacoesDoVendedor = (id) => call(sb.from('solicitacoes_mpdv').select(SOL_LIST).eq('vendedor_id', id).order('criado_em', { ascending: false }));
export const atualizarStatus = (id, status, mensagem) => rpc('mpdv_atualizar_status', { p_id: id, p_status: status, p_mensagem: mensagem || null });
export const liberarCancelamento = (id, liberar) => rpc('mpdv_liberar_cancelamento', { p_id: id, p_liberar: liberar });
export const adicionarNota = (id, texto) => rpc('mpdv_adicionar_nota', { p_id: id, p_texto: texto });
export const listNotas = (id) => call(sb.from('solicitacao_notas_mpdv').select('id,texto,criado_em').eq('solicitacao_id', id).order('criado_em', { ascending: false }));
export const listarVendedores = () => rpc('mpdv_listar_vendedores');
export const atualizarVendedor = (id, { nome = null, ativo = null }) => rpc('mpdv_atualizar_vendedor', { p_id: id, p_nome: nome, p_ativo: ativo });

export const criarProduto = (p) => call(sb.from('materiais_mpdv').insert(p).select().single());
export const atualizarProduto = (id, p) => call(sb.from('materiais_mpdv').update(p).eq('id', id).select().single());
export const excluirProduto = (id) => call(sb.from('materiais_mpdv').delete().eq('id', id));
export const ajustarEstoque = (id, delta, motivo) => rpc('mpdv_ajustar_estoque', { p_material_id: String(id), p_delta: delta, p_motivo: motivo || null });
export const definirEstoque = (id, novo, motivo) => rpc('mpdv_definir_estoque', { p_material_id: String(id), p_novo: novo, p_motivo: motivo || null });
export const listMovimentos = (id) => call(sb.from('estoque_movimentos_mpdv').select('id,delta,saldo_apos,tipo,motivo,criado_em').eq('material_id', id).order('criado_em', { ascending: false }).limit(12));

/** Redimensiona (máx. 900px) e envia ao Storage; devolve a URL pública. */
export async function uploadImagemProduto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new AppError('Use uma imagem JPG, PNG ou WebP.', 'ARQUIVO');
  if (file.size > 10 * 1024 * 1024) throw new AppError('Imagem muito grande (máx. 10 MB).', 'ARQUIVO');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85)); let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); ext = 'jpg'; }
  if (blob.size > 2 * 1024 * 1024) throw new AppError('Imagem ainda grande após otimização (máx. 2 MB).', 'ARQUIVO');
  const path = `p/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('produtos').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (error) throw toAppError(error);
  return sb.storage.from('produtos').getPublicUrl(path).data.publicUrl;
}

/* ---------- Realtime ---------- */
export function subscribeRealtime({ uid, papel, onEvent, onStatus }) {
  const ch = sb.channel(`mpdv-${papel}-${uid}-${Math.random().toString(36).slice(2, 7)}`);
  const solFilter = papel === 'vendedor' ? { filter: `vendedor_id=eq.${uid}` } : {};
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'solicitacoes_mpdv', ...solFilter }, (p) => onEvent('solicitacoes', p));
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitacao_historico_mpdv' }, (p) => onEvent('historico', p));
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'materiais_mpdv' }, (p) => onEvent('materiais', p));
  ch.subscribe((s) => onStatus?.(s));
  return () => { try { sb.removeChannel(ch); } catch { /* noop */ } };
}
