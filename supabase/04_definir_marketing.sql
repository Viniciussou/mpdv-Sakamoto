-- =====================================================================
-- 04_DEFINIR_MARKETING.SQL — promover um usuário a MARKETING
-- 1) Crie o usuário em Authentication > Users > Add user (com senha, "Auto Confirm").
-- 2) Troque o e-mail abaixo e rode no SQL Editor.
-- Todo usuário novo nasce como "vendedor". Só quem tem acesso ao SQL Editor
-- (dono do projeto) consegue promover — não existe caminho pela API.
-- =====================================================================
do $$
declare v_email text := 'COLOQUE_O_EMAIL_DO_MARKETING@empresa.com.br';
begin
  update public.perfis_mpdv set papel = 'marketing', ativo = true where lower(email) = lower(v_email);
  if not found then
    raise exception 'Usuário % não encontrado. Crie-o antes em Authentication > Users.', v_email;
  end if;
  raise notice 'OK: % agora é MARKETING.', v_email;
end $$;

-- Para listar perfis:
-- select email, papel, ativo from public.perfis_mpdv order by papel, email;
-- Para voltar alguém a vendedor:
-- update public.perfis_mpdv set papel = 'vendedor' where lower(email) = lower('x@empresa.com.br');
