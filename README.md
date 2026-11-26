# Loja MPDV Sakamoto — v2

Sistema de solicitação de materiais de ponto de venda com **dois ambientes** (Marketing e Vendedor),
regra de **uma solicitação por mês** aplicada no banco, controle de estoque, histórico e acompanhamento em tempo real.

Site estático (HTML + JS modular, **sem build**) + Supabase (Auth, Postgres/RLS, Storage, Realtime).

```
index.html                  entrada
assets/css/app.css          design system (responsivo)
assets/js/                  config, api, cart, main (login/rotas/realtime), views/ (vendedor, admin)
supabase/01_diagnostico.sql somente leitura — rode primeiro
supabase/02_migracao.sql    tabelas, RLS, RPCs, triggers, realtime (idempotente)
supabase/03_storage.sql     bucket de imagens dos produtos
supabase/04_definir_marketing.sql  promove um usuário a Marketing
supabase/tests/             testes (banco + ponta a ponta)
netlify.toml                cabeçalhos de segurança (CSP) para o Netlify
legado/                     arquivos originais enviados (preservados)
```

## 1. O que muda no Supabase

Nada existente é apagado. A tabela `materiais_mpdv` (id, nome, categoria, estoque, ativo) é **preservada**; só ganha
colunas `descricao, imagem_url, estoque_minimo, criado_em, atualizado_em`.

Novas tabelas (todas com RLS): `perfis_mpdv`, `solicitacoes_mpdv`, `solicitacao_itens_mpdv`,
`solicitacao_historico_mpdv`, `solicitacao_notas_mpdv` (internas), `estoque_movimentos_mpdv`, `auditoria_mpdv`.
Bucket público `produtos` (somente Marketing grava).

**Atenção:** a migração **remove as políticas RLS antigas de `materiais_mpdv`** (podiam ser permissivas demais) e cria as novas;
o nome de cada política removida aparece como NOTICE. Ela também revoga escrita direta de vendedores e o UPDATE direto
da coluna `estoque` (o estoque só muda pelas funções, que registram o movimento).

### Passo a passo
1. SQL Editor → rode `supabase/01_diagnostico.sql` e confira (principalmente `id` de `materiais_mpdv` e políticas existentes).
2. Rode `supabase/02_migracao.sql` (pode repetir sem problema; se uma tabela com o mesmo nome já existir e não for nossa, aborta).
3. Rode `supabase/03_storage.sql`.
4. **Authentication → Providers → Email → desligue “Allow new users to sign up”.** Todo usuário novo vira *vendedor*;
   com o cadastro aberto, qualquer pessoa poderia criar conta e solicitar.
5. **Authentication → URL Configuration:** em *Site URL* e *Redirect URLs* coloque a URL publicada (usada no “Esqueci minha senha”).
6. **Database → Replication / Realtime:** confira que `solicitacoes_mpdv`, `solicitacao_historico_mpdv` e `materiais_mpdv`
   estão na publicação `supabase_realtime` (a migração já tenta adicionar).

## 2. Perfis
- **Vendedor:** crie em *Authentication → Users → Add user* (e-mail + senha, *Auto Confirm*). O perfil nasce automaticamente
  como `vendedor`. Usuários que já existiam também viraram vendedores na migração.
- **Marketing:** crie o usuário igual a um vendedor e rode `supabase/04_definir_marketing.sql` com o e-mail dele.
  Não existe caminho pela API/interface para virar Marketing (gatilho no banco bloqueia).
- Desativar vendedor: tela *Vendedores* (ou `update perfis_mpdv set ativo=false`).

## 3. Variáveis de ambiente
Não há `.env` (site estático). A configuração pública está em `assets/js/config.js`: `SUPABASE_URL` e a chave
**publishable** (já preenchidas com as do seu projeto). **Nunca** coloque service_role/secret key no front.
Se mudar de projeto, ajuste também a URL no CSP do `netlify.toml`.

## 4. Como testar cada login
- Marketing → após entrar vai para `#/admin` (Dashboard, Pedidos, Produtos, Vendedores).
- Vendedor → vai para `#/loja` (Catálogo, Carrinho, Meus pedidos). Digitar `#/admin` na URL volta para a loja
  (e, mesmo que a tela fosse burlada, o banco nega os dados).
- Primeiro acesso / senha esquecida: “Esqueci minha senha” envia o link; a tela de nova senha já está implementada.

## 5. Publicar (Netlify)
Arraste a **pasta inteira** (não só o index.html) em *Deploys*, ou conecte o repositório (publish dir `.`, sem build).
O `netlify.toml` aplica CSP e demais cabeçalhos.

## 6. Regras de negócio (todas no banco)
- **1 solicitação viva por vendedor por mês** (mês calculado no servidor, fuso de Brasília): índice único parcial +
  trava por vendedor → duas requisições simultâneas não passam. Cancelada/**rejeitada** libera nova; análise, aprovada,
  separação, transporte e entregue bloqueiam.
- **Estoque:** reservado (debitado) ao enviar, com trava de linha; devolvido ao cancelar/rejeitar (uma única vez).
- **Cancelamento pelo vendedor:** aguardando análise e aprovado = sim; em separação = só se o Marketing marcar
  “Permitir cancelamento”; em transporte/entregue = não. Marketing pode cancelar qualquer pedido não entregue.
- **Fluxo do Marketing:** aguardando → aprovado → separação → transporte → entregue (com “voltar uma etapa”).
  Cancelado, rejeitado e entregue são finais.
- Registro de data, autor, papel e motivo em cancelamentos; histórico imutável; auditoria de produtos e perfis.
