# Testes
Foram executados num Postgres 16 local que simula o Supabase (`stub_supabase.sql`: schema auth, roles anon/authenticated,
JWT via `request.jwt.claim.sub`), com **PostgREST real** e um gateway de autenticação falso.

- `test_banco.py` — 69 verificações de RLS, RPCs, estoque e concorrência (25 requisições simultâneas, disputa de estoque,
  cancelamento simultâneo). `PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 test_banco.py t`
- `e2e.cjs` — 58 verificações no navegador (Playwright): login, rotas, carrinho, envio, bloqueios, cancelamento, status,
  mensagens, notas internas, produtos/imagem/estoque, vendedores, mobile/tablet, ataques diretos à API.
