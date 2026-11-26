-- =====================================================================
-- 01_DIAGNOSTICO.SQL  (somente leitura — não altera nada)
-- Rode no Supabase: SQL Editor > New query. Envie o resultado ao
-- desenvolvedor se algo parecer fora do esperado antes da migração.
-- =====================================================================

-- 1) Estrutura atual da tabela de produtos
select column_name, data_type, is_nullable, column_default, is_identity
from information_schema.columns
where table_schema = 'public' and table_name = 'materiais_mpdv'
order by ordinal_position;

-- 2) Políticas RLS existentes e se o RLS está ligado
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- 3) Tabelas que a migração vai criar (devem NÃO existir ainda)
select to_regclass('public.perfis_mpdv')               as perfis,
       to_regclass('public.solicitacoes_mpdv')         as solicitacoes,
       to_regclass('public.solicitacao_itens_mpdv')    as itens,
       to_regclass('public.solicitacao_historico_mpdv') as historico;

-- 4) Usuários já cadastrados no Auth (todos viram "vendedor" na migração)
select id, email, created_at, last_sign_in_at from auth.users order by created_at;

-- 5) Dados do catálogo (para conferir estoque negativo ou nulo)
select count(*) as total, count(*) filter (where estoque < 0) as estoque_negativo,
       count(*) filter (where estoque is null) as estoque_nulo
from public.materiais_mpdv;
