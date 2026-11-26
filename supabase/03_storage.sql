-- =====================================================================
-- 03_STORAGE.SQL — bucket de imagens dos produtos
-- Leitura pública (imagens aparecem no catálogo); gravação só Marketing.
-- Rode DEPOIS de 02_migracao.sql. Se der erro de coluna no bucket, crie o
-- bucket "produtos" pelo painel (Storage > New bucket > Public) e rode só
-- as políticas abaixo.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists mpdv_produtos_insert on storage.objects;
drop policy if exists mpdv_produtos_update on storage.objects;
drop policy if exists mpdv_produtos_delete on storage.objects;

create policy mpdv_produtos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and (select public.mpdv_is_marketing()));
create policy mpdv_produtos_update on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and (select public.mpdv_is_marketing()))
  with check (bucket_id = 'produtos' and (select public.mpdv_is_marketing()));
create policy mpdv_produtos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and (select public.mpdv_is_marketing()));
-- Leitura: o bucket é público, então as URLs públicas funcionam sem política de SELECT.
