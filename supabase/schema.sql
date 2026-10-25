-- ============================================================================
-- HTML OFFLINE STORE — ESQUEMA INICIAL / V0.1.0
-- Ejecutar desde Supabase > SQL Editor ANTES de abrir el registro al público.
-- Cada política aplica seguridad a nivel DB; los botones del frontend NO
-- sustituyen las verificaciones de autorización en el servidor.
-- ============================================================================

-- 01. Las identidades pertenecen a Supabase Auth; aquí solo datos públicos.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(80) not null default 'Member',
  role text not null default 'user' check (role in ('user','developer','admin')),
  created_at timestamptz not null default now()
);

-- 02. Categorías estables, cuyo slug se traduce exclusivamente en el cliente.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z-]{2,30}$')
);
insert into public.categories (slug) values
 ('tools'),('productivity'),('education'),('development'),
 ('graphics'),('games'),('utilities'),('other')
on conflict (slug) do nothing;

-- 03. Estado draft: evita que una subida interrumpida aparezca en moderación.
create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  category_id uuid not null references public.categories(id),
  title varchar(80) not null check (length(trim(title)) > 0),
  summary varchar(180) not null check (length(trim(summary)) > 0),
  description varchar(4000) not null check (length(trim(description)) > 0),
  status text not null default 'draft' check (status in ('draft','pending','published','rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint apps_author_id_fkey foreign key (author_id) references public.profiles(id)
);
-- NOTA: La FK anterior se declara con nombre explícito para el join PostgREST.
-- Si creó una tabla manual diferente previamente, haga migración antes de usar
-- este esquema; "if not exists" no modifica tablas preexistentes.
create index if not exists idx_apps_status_date on public.apps(status,published_at desc);
create index if not exists idx_apps_author on public.apps(author_id,created_at desc);

-- 04. Cada app de V0.1 tiene exactamente una versión y máximo 3 imágenes.
create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null unique references public.apps(id) on delete cascade,
  version varchar(30) not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,29}$'),
  storage_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_at timestamptz not null default now()
);
create table if not exists public.app_assets (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  storage_path text not null unique,
  unique(app_id,position)
);

-- 05. El primer inicio con GitHub crea el perfil de forma automática.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,display_name,role)
  values (
    new.id,
    coalesce(
      nullif(left(new.raw_user_meta_data->>'user_name',80),''),
      nullif(left(new.raw_user_meta_data->>'full_name',80),''),
      'Member'
    ),
    'user'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 06. Predicados privilegiados: evitan recursión en RLS de profiles.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id=(select auth.uid()) and role='admin');
$$;
create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id=(select auth.uid()) and role in ('developer','admin'));
$$;

-- 07. Autoriza la lectura pública, pero no los cambios directos de rol/estado.
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.apps enable row level security;
alter table public.app_versions enable row level security;
alter table public.app_assets enable row level security;

-- Principio de privilegio mínimo: GRANT más política RLS para cada operación.
revoke all on public.profiles,public.categories,public.apps,
  public.app_versions,public.app_assets from anon,authenticated;
grant select on public.profiles,public.categories to anon,authenticated;
grant select on public.apps,public.app_versions,public.app_assets to anon,authenticated;
grant insert,delete on public.apps to authenticated;
grant insert on public.app_versions,public.app_assets to authenticated;

-- Policies repetibles al reejecutar desde SQL Editor.
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles for select to anon,authenticated using (true);
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories for select to anon,authenticated using (true);

drop policy if exists apps_read_approved_owned_or_admin on public.apps;
create policy apps_read_approved_owned_or_admin on public.apps for select to anon,authenticated
  using (status='published' or author_id=(select auth.uid()) or public.is_admin());
drop policy if exists apps_creator_insert_draft on public.apps;
create policy apps_creator_insert_draft on public.apps for insert to authenticated
  with check (author_id=(select auth.uid()) and status='draft' and public.is_developer());
drop policy if exists apps_creator_delete_draft on public.apps;
create policy apps_creator_delete_draft on public.apps for delete to authenticated
  using (author_id=(select auth.uid()) and status='draft');

-- Una versión/imagen solo puede declararse si su ruta está dentro del UUID
-- del autor y la aplicación está todavía en estado draft.
drop policy if exists versions_read on public.app_versions;
create policy versions_read on public.app_versions for select to anon,authenticated
  using (exists(select 1 from public.apps a where a.id=app_id
    and (a.status='published' or a.author_id=(select auth.uid()) or public.is_admin())));
drop policy if exists versions_creator_insert on public.app_versions;
create policy versions_creator_insert on public.app_versions for insert to authenticated
  with check (
    exists(select 1 from public.apps a where a.id=app_id and a.author_id=(select auth.uid()) and a.status='draft')
    and storage_path = (select auth.uid())::text || '/' || app_id::text || '/application.html'
  );
drop policy if exists assets_read on public.app_assets;
create policy assets_read on public.app_assets for select to anon,authenticated
  using (exists(select 1 from public.apps a where a.id=app_id
    and (a.status='published' or a.author_id=(select auth.uid()) or public.is_admin())));
drop policy if exists assets_creator_insert on public.app_assets;
create policy assets_creator_insert on public.app_assets for insert to authenticated
  with check (
    exists(select 1 from public.apps a where a.id=app_id and a.author_id=(select auth.uid()) and a.status='draft')
    and storage_path = (select auth.uid())::text || '/' || app_id::text || '/screenshot_' || position::text ||
      case mime_type when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.webp' end
  );

-- 08. Buckets separados: pendientes privados, publicados públicos.
-- IMPORTANTE: se publica el HTML como application/octet-stream.
-- "download" en la URL pública fuerza attachment en la respuesta de Storage.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values
 ('pending-apps','pending-apps',false,10485760,
  array['application/octet-stream','image/png','image/jpeg','image/webp']),
 ('published-apps','published-apps',true,10485760,
  array['application/octet-stream','image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Los archivos no tienen permiso global de insert; cada bucket tiene reglas.
drop policy if exists pending_upload_drafts on storage.objects;
create policy pending_upload_drafts on storage.objects for insert to authenticated
with check (
  bucket_id='pending-apps'
  and split_part(name,'/',1)=(select auth.uid())::text
  and name=(split_part(name,'/',1) || '/' || split_part(name,'/',2) || '/' || split_part(name,'/',3))
  and (split_part(name,'/',3)='application.html'
       or split_part(name,'/',3) ~ '^screenshot_[1-3]\.(png|jpg|webp)$')
  and exists(select 1 from public.apps a
    where a.id::text=split_part(name,'/',2) and a.author_id=(select auth.uid()) and a.status='draft')
);
drop policy if exists pending_read_owner_admin on storage.objects;
create policy pending_read_owner_admin on storage.objects for select to authenticated
using (bucket_id='pending-apps'
  and (split_part(name,'/',1)=(select auth.uid())::text or public.is_admin()));
drop policy if exists pending_delete_draft_owner_admin on storage.objects;
create policy pending_delete_draft_owner_admin on storage.objects for delete to authenticated
using (bucket_id='pending-apps'
  and (public.is_admin() or (
     split_part(name,'/',1)=(select auth.uid())::text
     and exists(select 1 from public.apps a
       where a.id::text=split_part(name,'/',2) and a.author_id=(select auth.uid()) and a.status='draft')
  )));
drop policy if exists published_admin_only_insert on storage.objects;
create policy published_admin_only_insert on storage.objects for insert to authenticated
with check (
  bucket_id='published-apps' and public.is_admin()
  and exists(select 1 from public.apps a
    where a.id::text=split_part(name,'/',2) and a.status='pending'
      and a.author_id::text=split_part(name,'/',1))
);

-- 09. RPC: los usuarios sí pueden convertirse en desarrolladores, NUNCA
-- en administradores. No se permite actualizar profiles desde el cliente.
create or replace function public.become_developer()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  update public.profiles set role='developer'
    where id=(select auth.uid()) and role='user';
  if not found then raise exception 'Account is not eligible'; end if;
end;
$$;

-- 10. RPC submit: solo un draft completo puede pasar a la cola pendiente.
create or replace function public.submit_app(p_app_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.apps where id=p_app_id
      and author_id=(select auth.uid()) and status='draft') then
    raise exception 'Draft not found or unauthorized';
  end if;
  if not exists(select 1 from public.app_versions v join storage.objects o
      on o.bucket_id='pending-apps' and o.name=v.storage_path
      where v.app_id=p_app_id) then
    raise exception 'HTML upload missing';
  end if;
  if exists(select 1 from public.app_assets i
      where i.app_id=p_app_id and not exists(select 1 from storage.objects o
        where o.bucket_id='pending-apps' and o.name=i.storage_path)) then
    raise exception 'Screenshot upload missing';
  end if;
  update public.apps set status='pending' where id=p_app_id;
end;
$$;

-- 11. RPC publish: verifica permisos + existencia de todas las copias.
-- El archivo HTML se copia por la API Storage, nunca desde SQL Editor.
create or replace function public.approve_app(p_app_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required'; end if;
  if not exists(select 1 from public.apps where id=p_app_id and status='pending') then
    raise exception 'Pending app not found';
  end if;
  if not exists(select 1 from public.app_versions v join storage.objects o
      on o.bucket_id='published-apps' and o.name=v.storage_path
      where v.app_id=p_app_id) then
    raise exception 'Published HTML copy missing';
  end if;
  if exists(select 1 from public.app_assets i where i.app_id=p_app_id
      and not exists(select 1 from storage.objects o
        where o.bucket_id='published-apps' and o.name=i.storage_path)) then
    raise exception 'Published screenshot copy missing';
  end if;
  update public.apps set status='published',published_at=now(),rejection_reason=null
    where id=p_app_id and status='pending';
end;
$$;

-- 12. RPC reject: la app permanece privada para el autor.
create or replace function public.reject_app(p_app_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required'; end if;
  update public.apps set status='rejected' where id=p_app_id and status='pending';
  if not found then raise exception 'Pending app not found'; end if;
end;
$$;

-- 13. Restringir ejecución de funciones privilegiadas a usuarios con sesión.
revoke all on function public.is_admin() from public,anon;
revoke all on function public.is_developer() from public,anon;
revoke all on function public.become_developer() from public,anon;
revoke all on function public.submit_app(uuid) from public,anon;
revoke all on function public.approve_app(uuid) from public,anon;
revoke all on function public.reject_app(uuid) from public,anon;
-- is_admin() también se usa en filtros de SELECT público; con auth.uid()
-- nulo devuelve false, por eso anon puede ejecutarla sin obtener privilegios.
grant execute on function public.is_admin() to anon,authenticated;
grant execute on function public.is_developer(), public.become_developer(),
  public.submit_app(uuid), public.approve_app(uuid), public.reject_app(uuid) to authenticated;

-- ============================================================================
-- ADMINISTRADOR: ejecutar MANUALMENTE en SQL Editor DESPUÉS del primer login.
-- NO copiar credenciales de servicio al frontend. Sustituir un UUID real:
-- update public.profiles set role='admin' where id='UUID_DEL_USUARIO'::uuid;
-- Ver la sección "Primer administrador" de README.md.
-- ============================================================================
