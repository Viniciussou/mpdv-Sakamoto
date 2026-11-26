#!/usr/bin/env python3
"""
Testes de segurança/regras do banco (Postgres local simulando o Supabase).
Cada conexão faz SET ROLE authenticated + JWT sub => exatamente o que o PostgREST faz.
Uso:  PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 test_banco.py [dbname]
"""
import sys, os, threading, uuid
import psycopg2, psycopg2.extras

DB = sys.argv[1] if len(sys.argv) > 1 else "t"
MKT = "00000000-0000-0000-0000-00000000000a"
V1 = "00000000-0000-0000-0000-0000000000b1"
V2 = "00000000-0000-0000-0000-0000000000b2"
results = []

def conn():
    return psycopg2.connect(dbname=DB, host=os.environ.get("PGHOST", "/tmp"),
                            port=os.environ.get("PGPORT", 5544), user=os.environ.get("PGUSER", "postgres"))

def admin(sql, args=None):
    c = conn(); c.autocommit = True
    cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, args)
    try: r = cur.fetchall()
    except psycopg2.ProgrammingError: r = None
    c.close(); return r

class As:
    """Sessão como usuário autenticado (ou anon se uid=None)."""
    def __init__(self, uid):
        self.c = conn(); self.c.autocommit = True
        self.cur = self.c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if uid:
            self.cur.execute("set role authenticated")
            self.cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid,))
        else:
            self.cur.execute("set role anon")
    def q(self, sql, args=None):
        if isinstance(args, str): args = (args,)
        self.cur.execute(sql, args)
        try: return self.cur.fetchall()
        except psycopg2.ProgrammingError: return None
    def err(self, sql, args=None):
        """Retorna (sqlstate, detail, message) se falhar, senão None."""
        if isinstance(args, str): args = (args,)
        try:
            self.cur.execute(sql, args)
            try: self.cur.fetchall()
            except psycopg2.ProgrammingError: pass
            return None
        except psycopg2.Error as e:
            return (e.pgcode, (e.diag.message_detail or ""), (e.diag.message_primary or str(e)))
    def close(self): self.c.close()

def check(n, nome, ok, info=""):
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {n:>2}. {nome}" + (f"  -> {info}" if info and not ok else ""))

def reset():
    admin("delete from auth.users where id='00000000-0000-0000-0000-0000000000c3'")
    admin("""truncate public.solicitacao_itens_mpdv, public.solicitacao_historico_mpdv, public.solicitacao_notas_mpdv,
             public.estoque_movimentos_mpdv, public.solicitacoes_mpdv restart identity cascade""")
    admin("update public.materiais_mpdv set estoque = case nome when 'Banner Verão' then 10 when 'Display Balcão' then 3 when 'Faixa de Gôndola' then 50 else 9 end")
    admin("update public.perfis_mpdv set papel='marketing', ativo=true where id=%s", (MKT,))
    admin("update public.perfis_mpdv set papel='vendedor', ativo=true where id in (%s,%s)", (V1, V2))

def mid(nome):
    return str(admin("select id from public.materiais_mpdv where nome=%s", (nome,))[0]["id"])

def estoque(nome):
    return admin("select estoque from public.materiais_mpdv where nome=%s", (nome,))[0]["estoque"]

reset()
BANNER, DISPLAY, FAIXA, INATIVO = mid("Banner Verão"), mid("Display Balcão"), mid("Faixa de Gôndola"), mid("Item Inativo")
def itens(*pairs):
    import json; return json.dumps([{"material_id": m, "quantidade": q} for m, q in pairs])

# ---------------------------------------------------------------- perfis
m, v1, v2 = As(MKT), As(V1), As(V2)
check(1, "Marketing é identificado como marketing", m.q("select public.mpdv_papel_atual() p")[0]["p"] == "marketing")
check(2, "Vendedor é identificado como vendedor", v1.q("select public.mpdv_papel_atual() p")[0]["p"] == "vendedor")

# vendedor não acessa nada administrativo
e = [v1.err("select public.mpdv_dashboard()"), v1.err("select * from public.mpdv_listar_vendedores()"),
     v1.err("select public.mpdv_atualizar_vendedor(%s, 'x', false)", (V2,)),
     v1.err("select public.mpdv_ajustar_estoque(%s, 100, 'x')", (BANNER,)),
     v1.err("select public.mpdv_definir_estoque(%s, 999, 'x')", (BANNER,)),
     v1.err("select public.mpdv_adicionar_nota(gen_random_uuid(), 'x')"),
     v1.err("select public.mpdv_atualizar_status(gen_random_uuid(), 'aprovado')"),
     v1.err("select public.mpdv_liberar_cancelamento(gen_random_uuid(), true)")]
check(3, "Vendedor NÃO executa nenhuma RPC administrativa (8 chamadas negadas)", all(x and x[1] == "SEM_PERMISSAO" for x in e), e)

# vendedor não escreve em produtos / tabelas (erro de permissão OU 0 linhas afetadas pelo filtro RLS)
def efeito(sql, args=None):
    try:
        v1.cur.execute(sql, args); return v1.cur.rowcount
    except psycopg2.Error:
        return -1   # negado com erro
res = [efeito("update public.materiais_mpdv set estoque=9999 where id=%s", (BANNER,)),
       efeito("update public.materiais_mpdv set nome='hack' where id=%s", (BANNER,)),
       efeito("insert into public.materiais_mpdv(nome,estoque) values ('x',1)"),
       efeito("delete from public.materiais_mpdv where id=%s", (BANNER,)),
       efeito("insert into public.solicitacoes_mpdv(vendedor_id,mes_referencia,status) values (%s, date_trunc('month',now())::date,'entregue')", (V1,)),
       efeito("update public.perfis_mpdv set papel='marketing' where id=%s", (V1,)),
       efeito("insert into public.solicitacao_historico_mpdv(solicitacao_id,evento) values (gen_random_uuid(),'x')")]
intacto = admin("select nome from public.materiais_mpdv where id=%s", (BANNER,))
check(3.1, "Vendedor NÃO escreve direto em produtos/solicitações/perfis/histórico (7 tentativas sem efeito)",
      all(r <= 0 for r in res) and intacto and intacto[0]["nome"] == "Banner Verão" and
      admin("select papel from public.perfis_mpdv where id=%s", (V1,))[0]["papel"] == "vendedor", res)
check(3.2, "Estoque do Banner permaneceu intacto", estoque("Banner Verão") == 10)

# Nem marketing consegue mexer em estoque por UPDATE direto (só RPC)
x = m.err("update public.materiais_mpdv set estoque = 1 where id=%s", (BANNER,))
check(3.3, "Nem o Marketing altera 'estoque' por UPDATE direto (só via RPC auditada)", x is not None and x[0] == "42501", x)

# anon não vê nada
a = As(None)
x = [a.err("select * from public.materiais_mpdv"), a.err("select * from public.solicitacoes_mpdv"),
     a.err("select public.mpdv_criar_solicitacao('[]'::jsonb)")]
check(3.4, "Visitante anônimo (sem login) não lê produtos, pedidos nem executa RPC", all(i is not None for i in x), x)

# vendedor só vê produtos ativos
nomes = [r["nome"] for r in v1.q("select nome from public.materiais_mpdv")]
check(3.5, "Vendedor vê só produtos ativos; Marketing vê todos",
      "Item Inativo" not in nomes and len(nomes) == 3 and len(m.q("select 1 from public.materiais_mpdv")) == 4, nomes)

# ---------------------------------------------------------------- carrinho / criação / estoque
x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((BANNER, 999)),))
check(12, "Estoque não permite quantidade indisponível (999 > 10)", x and x[1] == "ESTOQUE_INSUFICIENTE", x)
x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((INATIVO, 1)),))
check(12.1, "Produto inativo não pode ser solicitado", x and x[1] == "PRODUTO_INDISPONIVEL", x)
x = [v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((BANNER, 0)),)),
     v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((BANNER, -5)),)),
     v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", ('[{"material_id":"%s","quantidade":1.5}]' % BANNER,)),
     v1.err("select public.mpdv_criar_solicitacao('[]'::jsonb)"),
     v1.err("select public.mpdv_criar_solicitacao('{\"a\":1}'::jsonb)"),
     v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", ('[{"material_id":"abc","quantidade":1}]',))]
check(12.2, "Quantidades zero/negativas/decimais, carrinho vazio ou produto inexistente são rejeitados", all(i is not None for i in x), x)
check(12.3, "Nenhuma dessas tentativas alterou o estoque", estoque("Banner Verão") == 10)

# duas linhas do mesmo produto somam (não burlam estoque)
x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((DISPLAY, 2), (DISPLAY, 2)),))
check(12.4, "Linhas repetidas do mesmo produto são somadas (2+2 > estoque 3 => bloqueia)", x and x[1] == "ESTOQUE_INSUFICIENTE", x)

r = v1.q("select public.mpdv_criar_solicitacao(%s::jsonb, 'Entregar na loja 5') r", (itens((BANNER, 4), (FAIXA, 10)),))[0]["r"]
sol1 = r["id"]
check(6, "Vendedor realiza uma solicitação", r["numero"] == 1 and estoque("Banner Verão") == 6 and estoque("Faixa de Gôndola") == 40,
      f"{r} banner={estoque('Banner Verão')}")
st = v1.q("select status from public.solicitacoes_mpdv")[0]["status"]
check(6.1, "Status inicial = aguardando_analise e histórico 'criacao' gravado",
      st == "aguardando_analise" and len(v1.q("select 1 from public.solicitacao_historico_mpdv where evento='criacao'")) == 1)

x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((DISPLAY, 1)),))
check(7, "Vendedor NÃO consegue 2ª solicitação no mesmo mês (aguardando_analise)", x and x[1] == "LIMITE_MENSAL", x)
check(7.1, "Estoque não foi consumido pela tentativa bloqueada", estoque("Display Balcão") == 3)

# vendedor 2 independente
r2 = v2.q("select public.mpdv_criar_solicitacao(%s::jsonb) r", (itens((BANNER, 2),)),)[0]["r"]
sol2 = r2["id"]

# isolamento entre vendedores
ids1 = [str(r["id"]) for r in v1.q("select id from public.solicitacoes_mpdv")]
ids2 = [str(r["id"]) for r in v2.q("select id from public.solicitacoes_mpdv")]
check(4, "Vendedor NÃO vê pedidos de outro vendedor (SELECT direto)", ids1 == [str(sol1)] and ids2 == [str(sol2)], (ids1, ids2))
check(4.1, "Itens, histórico e notas de outro vendedor também ficam invisíveis",
      len(v1.q("select 1 from public.solicitacao_itens_mpdv where solicitacao_id=%s", (sol2,))) == 0 and
      len(v1.q("select 1 from public.solicitacao_historico_mpdv where solicitacao_id=%s", (sol2,))) == 0 and
      len(v1.q("select 1 from public.solicitacao_notas_mpdv")) == 0)
x = v1.err("select public.mpdv_cancelar_solicitacao(%s)", (sol2,))
check(4.2, "Vendedor NÃO cancela pedido de outro vendedor", x and x[1] == "NAO_ENCONTRADA", x)
check(4.3, "Vendedor NÃO lê perfis de outros nem movimentos/auditoria",
      len(v1.q("select 1 from public.perfis_mpdv")) == 1 and len(v1.q("select 1 from public.estoque_movimentos_mpdv")) == 0 and len(v1.q("select 1 from public.auditoria_mpdv")) == 0)
check(4.4, "Marketing vê todas as solicitações", len(m.q("select 1 from public.solicitacoes_mpdv")) == 2)

# vendedor não muda status por UPDATE direto nem por RPC admin
x = v1.err("update public.solicitacoes_mpdv set status='entregue' where id=%s", (sol1,))
check(3.6, "Vendedor NÃO altera status por UPDATE direto", x is not None)
check(3.7, "Status permanece aguardando_analise", admin("select status from public.solicitacoes_mpdv where id=%s", (sol1,))[0]["status"] == "aguardando_analise")

# ---------------------------------------------------------------- cancelamento libera nova
r = v1.q("select public.mpdv_cancelar_solicitacao(%s, 'Mudei de ideia') r", (sol1,))[0]["r"]
row = admin("select * from public.solicitacoes_mpdv where id=%s", (sol1,))[0]
check(8, "Cancelamento permitido registra data, autor, papel e motivo",
      r["status"] == "cancelado" and row["cancelado_em"] and str(row["cancelado_por"]) == V1 and row["cancelado_por_papel"] == "vendedor" and row["motivo_cancelamento"] == "Mudei de ideia", row)
check(8.1, "Cancelamento devolve o estoque", estoque("Banner Verão") == 8 - 0 + 4 - 2 + 0 or (estoque("Banner Verão") == 8 and estoque("Faixa de Gôndola") == 50), (estoque("Banner Verão"), estoque("Faixa de Gôndola")))
x = v1.err("select public.mpdv_cancelar_solicitacao(%s)", (sol1,))
check(8.2, "Não é possível cancelar duas vezes (estoque não devolve em dobro)", x and x[1] == "JA_ENCERRADA" and estoque("Faixa de Gôndola") == 50, x)
r3 = v1.q("select public.mpdv_criar_solicitacao(%s::jsonb) r", (itens((DISPLAY, 1),)),)[0]["r"]
check(8.3, "Após cancelar, o vendedor consegue NOVA solicitação no mês", r3["numero"] == 3, r3)
sol1b = r3["id"]
x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((DISPLAY, 1)),))
check(8.4, "...mas a nova também passa a bloquear a seguinte", x and x[1] == "LIMITE_MENSAL", x)

# ---------------------------------------------------------------- transição / transporte
x = m.err("select public.mpdv_atualizar_status(%s, 'entregue')", (sol1b,))
check(10, "Transição inválida (aguardando -> entregue) é recusada", x and x[1] == "TRANSICAO_INVALIDA", x)
for s in ["aprovado", "em_separacao"]:
    m.q("select public.mpdv_atualizar_status(%s, %s, %s)", (sol1b, s, f"Agora: {s}"))
x = v1.err("select public.mpdv_cancelar_solicitacao(%s)", (sol1b,))
check(5.1, "Em separação SEM autorização: vendedor não cancela", x and x[1] == "CANCELAMENTO_BLOQUEADO", x)
m.q("select public.mpdv_liberar_cancelamento(%s, true)", (sol1b,))
check(5.2, "Marketing autoriza e o vendedor passa a poder ver 'cancelamento_liberado'",
      v1.q("select cancelamento_liberado c from public.solicitacoes_mpdv where id=%s", (sol1b,))[0]["c"] is True)
m.q("select public.mpdv_liberar_cancelamento(%s, false)", (sol1b,))
m.q("select public.mpdv_atualizar_status(%s, 'em_transporte', 'Saiu para entrega')", (sol1b,))
x = v1.err("select public.mpdv_cancelar_solicitacao(%s)", (sol1b,))
check(9, "Pedido EM TRANSPORTE não pode ser cancelado pelo vendedor (mensagem oficial)",
      x and x[1] == "CANCELAMENTO_BLOQUEADO" and "já está em processo de entrega" in x[2], x)
x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((FAIXA, 1)),))
check(9.1, "Em transporte continua bloqueando nova solicitação", x and x[1] == "LIMITE_MENSAL", x)
x = m.err("select public.mpdv_atualizar_status(%s, 'cancelado')", (sol1b,))  # marketing pode cancelar
check(9.2, "Marketing pode cancelar (mesmo em transporte) — fluxo administrativo", x is None, x)
# a partir daqui sol1b cancelado -> libera. Cria de novo para testar entregue
r4 = v1.q("select public.mpdv_criar_solicitacao(%s::jsonb) r", (itens((FAIXA, 1),)),)[0]["r"]["id"]
for s in ["aprovado", "em_separacao", "em_transporte", "entregue"]:
    m.q("select public.mpdv_atualizar_status(%s, %s)", (r4, s))
check(10.1, "Marketing percorre todo o fluxo até 'entregue'", admin("select status from public.solicitacoes_mpdv where id=%s", (r4,))[0]["status"] == "entregue")
x = v1.err("select public.mpdv_cancelar_solicitacao(%s)", (r4,))
check(10.2, "Entregue não pode ser cancelada", x and x[1] == "CANCELAMENTO_BLOQUEADO", x)
x = v1.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((FAIXA, 1)),))
check(10.3, "Entregue bloqueia nova solicitação no mesmo mês", x and x[1] == "LIMITE_MENSAL", x)
x = m.err("select public.mpdv_atualizar_status(%s, 'cancelado')", (r4,))
check(10.4, "Entregue é terminal: nem o Marketing cancela", x and x[1] == "TRANSICAO_INVALIDA", x)

# timeline visível para o vendedor
h = [r["status_novo"] for r in v1.q("select status_novo from public.solicitacao_historico_mpdv where solicitacao_id=%s order by id", (r4,))]
check(11, "Vendedor enxerga a linha do tempo atualizada pelo Marketing", h == ["aguardando_analise", "aprovado", "em_separacao", "em_transporte", "entregue"], h)
m.q("select public.mpdv_adicionar_nota(%s, 'Cliente pediu urgência')", (r4,))
check(11.1, "Observação interna existe para o Marketing e é invisível ao vendedor",
      len(m.q("select 1 from public.solicitacao_notas_mpdv")) == 1 and len(v1.q("select 1 from public.solicitacao_notas_mpdv")) == 0)

# rejeição devolve estoque e libera mês
est_antes = estoque("Display Balcão")
r5 = v2.q("select public.mpdv_cancelar_solicitacao(%s)", (sol2,))  # v2 cancela a sua
r6 = v2.q("select public.mpdv_criar_solicitacao(%s::jsonb) r", (itens((DISPLAY, 2),)),)[0]["r"]["id"]
check(11.2, "Reserva de estoque na criação", estoque("Display Balcão") == est_antes - 2)
m.q("select public.mpdv_atualizar_status(%s, 'rejeitado', 'Fora da política')", (r6,))
check(11.3, "Rejeição devolve estoque", estoque("Display Balcão") == est_antes)
r7 = v2.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((DISPLAY, 1)),))
check(11.4, "Rejeitada libera nova solicitação no mês", r7 is None, r7)

# estado do mês (servidor é a autoridade)
es = v1.q("select public.mpdv_estado_mes() e")[0]["e"]
check(11.5, "mpdv_estado_mes() informa a solicitação ativa", es["solicitacao"] and es["solicitacao"]["status"] == "entregue", es)

# ---------------------------------------------------------------- estoque RPC / auditoria
m.q("select public.mpdv_ajustar_estoque(%s, 5, 'Entrada NF 123')", (INATIVO,))
x = m.err("select public.mpdv_ajustar_estoque(%s, -999, 'x')", (INATIVO,))
check(12.5, "Marketing não consegue deixar estoque negativo", x and x[1] == "ESTOQUE_INSUFICIENTE", x)
m.q("select public.mpdv_definir_estoque(%s, 20, 'Contagem')", (INATIVO,))
check(12.6, "Marketing define estoque pela RPC", estoque("Item Inativo") == 20)
mov = admin("select tipo, delta, motivo from public.estoque_movimentos_mpdv where material_id=%s order by id", (INATIVO,))
check(12.7, "Movimentos de estoque registrados (ajuste +5, +6 via definir)", [x["delta"] for x in mov] == [5, 6] and mov[0]["motivo"] == "Entrada NF 123", mov)
tipos = {r["tipo"] for r in admin("select distinct tipo from public.estoque_movimentos_mpdv")}
check(12.8, "Tipos de movimento: reserva, devolucao, ajuste", {"reserva", "devolucao", "ajuste"} <= tipos, tipos)

# Marketing CRUD de produtos
x = m.err("insert into public.materiais_mpdv(nome,categoria,estoque,descricao) values ('Novo Totem','Totens',7,'desc')")
check(12.9, "Marketing cadastra produto (RLS permite)", x is None, x)
x = m.err("update public.materiais_mpdv set nome='Novo Totem 2', ativo=false where nome='Novo Totem'")
check(12.10, "Marketing edita/desativa produto", x is None, x)
aud = admin("select count(*) c from public.auditoria_mpdv where tabela='materiais_mpdv'")[0]["c"]
check(12.11, "Auditoria registrou alterações de produto", aud >= 2, aud)
x = m.err("delete from public.materiais_mpdv where nome='Novo Totem 2'")
check(12.12, "Marketing exclui produto nunca solicitado (cascata do histórico de estoque permitida)", x is None, x)
x = m.err("delete from public.materiais_mpdv where id=%s", (BANNER,))
check(12.13, "Produto já solicitado NÃO pode ser excluído (deve ser desativado)", x and x[0] == "23503", x)
x = m.err("update public.solicitacao_historico_mpdv set mensagem='x'")
check(12.14, "Histórico é imutável (nem Marketing altera)", x is not None)

# Perfis: Marketing gerencia vendedor; ninguém se auto-promove
m.q("select public.mpdv_atualizar_vendedor(%s, null, false)", (V2,))
x = v2.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((FAIXA, 1)),))
check(13.1, "Vendedor DESATIVADO não consegue solicitar", x and x[1] == "SEM_PERMISSAO", x)
check(13.2, "Vendedor DESATIVADO deixa de ver produtos e pedidos",
      len(v2.q("select 1 from public.materiais_mpdv")) == 0 and len(v2.q("select 1 from public.solicitacoes_mpdv")) == 0)
check(13.3, "Vendedor desativado ainda lê o próprio perfil (para a tela 'conta desativada')", v2.q("select ativo from public.perfis_mpdv")[0]["ativo"] is False)
m.q("select public.mpdv_atualizar_vendedor(%s, null, true)", (V2,))
x = m.err("select public.mpdv_atualizar_vendedor(%s, null, false)", (MKT,))
check(13.4, "Marketing não consegue desativar conta de Marketing (nem a própria)", x and x[1] == "NAO_ENCONTRADA", x)
x = m.err("update public.perfis_mpdv set papel='vendedor' where id=%s", (MKT,))
check(13.5, "Ninguém altera papel por UPDATE direto (nem Marketing)", x is not None, x)
lv = m.q("select * from public.mpdv_listar_vendedores()")
check(13.6, "Marketing lista vendedores com totais e status do mês", len(lv) == 2 and all("total_solicitacoes" in r for r in lv), lv)
dash = m.q("select public.mpdv_dashboard() d")[0]["d"]
check(13.7, "Dashboard retorna contagens", dash["total"] == 6 and dash["cancelado"] == 3 and dash["entregue"] == 1 and dash["rejeitado"] == 1 and dash["aguardando_analise"] == 1 and dash["vendedores_ativos"] == 2 and dash["estoque_baixo"] == 1, dash)

# ---------------------------------------------------------------- CONCORRÊNCIA
reset()
admin("update public.materiais_mpdv set estoque=100 where nome='Banner Verão'")
N = 25
out = []
barrier = threading.Barrier(N)
def worker(i):
    s = As(V1)
    barrier.wait()
    out.append(s.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((BANNER, 3),)),))
    s.close()
ts = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
[t.start() for t in ts]; [t.join() for t in ts]
okc = sum(1 for o in out if o is None); lim = sum(1 for o in out if o and o[1] == "LIMITE_MENSAL"); outros = [o for o in out if o and o[1] != "LIMITE_MENSAL"]
cnt = admin("select count(*) c from public.solicitacoes_mpdv where vendedor_id=%s", (V1,))[0]["c"]
check(14, f"{N} requisições simultâneas do mesmo vendedor => exatamente 1 solicitação",
      okc == 1 and lim == N - 1 and cnt == 1 and not outros, f"ok={okc} limite={lim} outros={outros} linhas={cnt}")
check(14.1, "Estoque debitado uma única vez (100 - 3 = 97)", estoque("Banner Verão") == 97, estoque("Banner Verão"))

# Concorrência: muitos vendedores disputando o último estoque
reset()
admin("update public.materiais_mpdv set estoque=3 where nome='Banner Verão'")
admin("update public.perfis_mpdv set papel='vendedor'")  # marketing também vira vendedor só p/ este teste
admin("update public.perfis_mpdv set papel='marketing' where id=%s", (MKT,))
barrier2 = threading.Barrier(2)
out2 = []
def w2(uid):
    s = As(uid); barrier2.wait()
    out2.append(s.err("select public.mpdv_criar_solicitacao(%s::jsonb)", (itens((BANNER, 2),)),)); s.close()
t = [threading.Thread(target=w2, args=(u,)) for u in (V1, V2)]
[x.start() for x in t]; [x.join() for x in t]
check(14.2, "Dois vendedores disputando estoque 3 (2+2): só um vence, estoque nunca fica negativo",
      sum(1 for o in out2 if o is None) == 1 and estoque("Banner Verão") == 1, (out2, estoque("Banner Verão")))

# Cancelamento concorrente x atualização de status do Marketing (sem estoque duplicado)
reset()
sol = As(V1).q("select public.mpdv_criar_solicitacao(%s::jsonb) r", (itens((BANNER, 4),)),)[0]["r"]["id"]
bar3 = threading.Barrier(2); res3 = []
def cancela():
    s = As(V1); bar3.wait(); res3.append(("v", s.err("select public.mpdv_cancelar_solicitacao(%s)", (sol,)))); s.close()
def cancela_mkt():
    s = As(MKT); bar3.wait(); res3.append(("m", s.err("select public.mpdv_atualizar_status(%s,'cancelado')", (sol,)))); s.close()
t = [threading.Thread(target=cancela), threading.Thread(target=cancela_mkt)]
[x.start() for x in t]; [x.join() for x in t]
check(14.3, "Cancelamento simultâneo (vendedor + Marketing): estoque devolvido uma única vez (=10)",
      estoque("Banner Verão") == 10 and sum(1 for _, e in res3 if e is None) == 1, (res3, estoque("Banner Verão")))

# ---------------------------------------------------------------- RLS ligado em tudo
rls = admin("""select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
               where n.nspname='public' and c.relname in ('materiais_mpdv','perfis_mpdv','solicitacoes_mpdv','solicitacao_itens_mpdv',
               'solicitacao_historico_mpdv','solicitacao_notas_mpdv','estoque_movimentos_mpdv','auditoria_mpdv')""")
check(15, "RLS ativo nas 8 tabelas", len(rls) == 8 and all(r["relrowsecurity"] for r in rls), rls)
pol = admin("select policyname from public.pg_policies where tablename='materiais_mpdv'") if False else admin("select policyname from pg_policies where schemaname='public' and tablename='materiais_mpdv'")
check(15.1, "Política permissiva legada foi removida de materiais_mpdv", all(p["policyname"].startswith("mpdv_") for p in pol), pol)

# usuário novo => vendedor (mesmo tentando se declarar marketing nos metadados)
admin("delete from auth.users where id='00000000-0000-0000-0000-0000000000c3'")
admin("insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c3','novo@x.com','{\"papel\":\"marketing\",\"nome\":\"Novo\"}')")
p = admin("select papel, nome from public.perfis_mpdv where email='novo@x.com'")[0]
check(15.2, "Novo usuário do Auth nasce 'vendedor' (metadado papel=marketing é ignorado)", p["papel"] == "vendedor" and p["nome"] == "Novo", p)

print()
tot, ok = len(results), sum(results)
print(f"RESULTADO: {ok}/{tot} verificações aprovadas")
sys.exit(0 if ok == tot else 1)
