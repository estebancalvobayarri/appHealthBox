-- =====================================================================
--  Hora Fit · instalación de la base de datos en Supabase
--  Pégalo entero en Supabase → SQL Editor → "Run".
--  Se puede volver a ejecutar sin perder datos.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Las tablas viven en un esquema privado que la API pública no expone.
-- La app solo puede hablar con la base de datos a través de las funciones
-- "hf_*" de más abajo, que comprueban la sesión en cada llamada.
create schema if not exists horafit;
revoke all on schema horafit from public;

-- ---------------------------------------------------------------------
--  Tablas
-- ---------------------------------------------------------------------
create table if not exists horafit.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists companies_name_uq on horafit.companies (lower(name));
-- Logo de la empresa como imagen incrustada (data:image/...), reducida en el navegador antes de subirla.
alter table horafit.companies add column if not exists logo text;

create table if not exists horafit.users (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references horafit.companies(id) on delete cascade,
  username      text not null,
  display_name  text,
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists users_company_username_uq on horafit.users (company_id, lower(username));

create table if not exists horafit.admins (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);
create unique index if not exists admins_username_uq on horafit.admins (lower(username));

create table if not exists horafit.videos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  url         text not null,
  category    text,
  sort_order  int not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists horafit.video_views (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references horafit.users(id) on delete cascade,
  company_id       uuid not null references horafit.companies(id) on delete cascade,
  video_id         uuid references horafit.videos(id) on delete set null,
  video_title      text not null,           -- copia del título, por si el vídeo se borra
  watched_seconds  numeric(10,1),
  duration_seconds numeric(10,1),
  completed_at     timestamptz not null default now()
);
create index if not exists video_views_user_idx    on horafit.video_views (user_id, video_id);
create index if not exists video_views_company_idx on horafit.video_views (company_id, completed_at desc);

create table if not exists horafit.sessions (
  token      text primary key,
  kind       text not null check (kind in ('company','user','admin')),
  company_id uuid references horafit.companies(id) on delete cascade,
  user_id    uuid references horafit.users(id) on delete cascade,
  admin_id   uuid references horafit.admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists horafit.login_attempts (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_key_idx on horafit.login_attempts (key, created_at);

-- Nadie entra a las tablas directamente (defensa extra además del esquema privado).
alter table horafit.companies      enable row level security;
alter table horafit.users          enable row level security;
alter table horafit.admins         enable row level security;
alter table horafit.videos         enable row level security;
alter table horafit.video_views    enable row level security;
alter table horafit.sessions       enable row level security;
alter table horafit.login_attempts enable row level security;

-- ---------------------------------------------------------------------
--  Utilidades internas
-- ---------------------------------------------------------------------
create or replace function horafit.new_token() returns text
language sql volatile set search_path = horafit, extensions, public as $$
  select encode(extensions.gen_random_bytes(32), 'hex');
$$;

create or replace function horafit.hash_pw(p text) returns text
language sql volatile set search_path = horafit, extensions, public as $$
  select extensions.crypt(p, extensions.gen_salt('bf', 10));
$$;

create or replace function horafit.check_pw(p text, h text) returns boolean
language sql stable set search_path = horafit, extensions, public as $$
  select h is not null and p is not null and extensions.crypt(p, h) = h;
$$;

-- Los logins fallidos devuelven {error} en vez de lanzar una excepción para que
-- el intento quede guardado (una excepción desharía el registro).
-- Frena los intentos de adivinar contraseñas: 10 fallos en 15 minutos bloquean esa clave.
create or replace function horafit.guard_attempts(p_key text) returns void
language plpgsql set search_path = horafit, extensions, public as $$
begin
  delete from horafit.login_attempts where created_at < now() - interval '1 day';
  if (select count(*) from horafit.login_attempts
      where key = p_key and created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.';
  end if;
end $$;

create or replace function horafit.fail_attempt(p_key text) returns void
language sql set search_path = horafit, extensions, public as $$
  insert into horafit.login_attempts (key) values (p_key);
$$;

create or replace function horafit.check_password_rules(p text) returns void
language plpgsql set search_path = horafit, extensions, public as $$
begin
  if p is null or length(p) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres.';
  end if;
end $$;

-- Devuelve la sesión válida o lanza un error.
create or replace function horafit.session_for(p_token text, p_kind text)
returns horafit.sessions
language plpgsql set search_path = horafit, extensions, public as $$
declare s horafit.sessions;
begin
  select * into s from horafit.sessions
   where token = p_token and kind = p_kind and expires_at > now();
  if not found then
    raise exception 'SESSION_EXPIRED' using hint = 'La sesión ha caducado. Vuelve a entrar.';
  end if;
  return s;
end $$;

create or replace function horafit.require_admin(p_token text) returns uuid
language plpgsql set search_path = horafit, extensions, public as $$
begin
  return (horafit.session_for(p_token, 'admin')).admin_id;
end $$;

-- Para crear el primer administrador desde el SQL Editor (no accesible desde la web).
create or replace function horafit.create_admin(p_username text, p_password text) returns void
language plpgsql set search_path = horafit, extensions, public as $$
begin
  perform horafit.check_password_rules(p_password);
  insert into horafit.admins (username, password_hash)
  values (trim(p_username), horafit.hash_pw(p_password))
  on conflict ((lower(username))) do update set password_hash = excluded.password_hash;
end $$;

-- ---------------------------------------------------------------------
--  API para la app (empleados)
-- ---------------------------------------------------------------------
create or replace function public.hf_company_login(p_name text, p_password text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare c horafit.companies; t text; k text := 'company:' || lower(trim(coalesce(p_name,'')));
begin
  perform horafit.guard_attempts(k);
  select * into c from horafit.companies where lower(name) = lower(trim(p_name)) and active;
  if not found or not horafit.check_pw(p_password, c.password_hash) then
    perform horafit.fail_attempt(k);
    return json_build_object('error', 'El nombre de empresa o la contraseña no son correctos.');
  end if;
  t := horafit.new_token();
  insert into horafit.sessions (token, kind, company_id, expires_at)
  values (t, 'company', c.id, now() + interval '180 days');
  return json_build_object('token', t, 'company_name', c.name, 'logo', c.logo);
end $$;

-- Datos de marca de la empresa (nombre y logo) para refrescarlos en dispositivos ya conectados.
create or replace function public.hf_company_info(p_company_token text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare s horafit.sessions; c horafit.companies;
begin
  s := horafit.session_for(p_company_token, 'company');
  select * into c from horafit.companies where id = s.company_id;
  return json_build_object('company_name', c.name, 'logo', c.logo);
end $$;

create or replace function public.hf_user_login(p_company_token text, p_username text, p_password text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare s horafit.sessions; u horafit.users; t text; k text;
begin
  s := horafit.session_for(p_company_token, 'company');
  k := 'user:' || s.company_id || ':' || lower(trim(coalesce(p_username,'')));
  perform horafit.guard_attempts(k);
  select * into u from horafit.users
   where company_id = s.company_id and lower(username) = lower(trim(p_username)) and active;
  if not found or not horafit.check_pw(p_password, u.password_hash) then
    perform horafit.fail_attempt(k);
    return json_build_object('error', 'El usuario o la contraseña no son correctos.');
  end if;
  t := horafit.new_token();
  insert into horafit.sessions (token, kind, company_id, user_id, expires_at)
  values (t, 'user', s.company_id, u.id, now() + interval '30 days');
  return json_build_object('token', t, 'username', u.username,
                           'display_name', coalesce(nullif(u.display_name,''), u.username));
end $$;

create or replace function public.hf_logout(p_token text) returns void
language sql security definer set search_path = horafit, extensions, public as $$
  delete from horafit.sessions where token = p_token;
$$;

create or replace function public.hf_list_videos(p_user_token text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare s horafit.sessions;
begin
  s := horafit.session_for(p_user_token, 'user');
  return coalesce((
    select json_agg(row_to_json(v) order by v.sort_order, v.title) from (
      select vi.id, vi.title, vi.description, vi.url, vi.category, vi.sort_order,
             (select count(*) from horafit.video_views w
               where w.user_id = s.user_id and w.video_id = vi.id) as times_completed,
             (select max(completed_at) from horafit.video_views w
               where w.user_id = s.user_id and w.video_id = vi.id) as last_completed_at
        from horafit.videos vi where vi.active
    ) v), '[]'::json);
end $$;

create or replace function public.hf_record_view(p_user_token text, p_video_id uuid,
                                                 p_watched_seconds numeric, p_duration_seconds numeric) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare s horafit.sessions; v horafit.videos; n int;
begin
  s := horafit.session_for(p_user_token, 'user');
  select * into v from horafit.videos where id = p_video_id and active;
  if not found then raise exception 'Ese vídeo ya no está disponible.'; end if;
  if p_duration_seconds is null or p_duration_seconds <= 0
     or p_watched_seconds < p_duration_seconds * 0.9 then
    raise exception 'El vídeo no se ha visto completo.';
  end if;
  -- Evita registros duplicados por el mismo final de vídeo.
  if not exists (select 1 from horafit.video_views
                  where user_id = s.user_id and video_id = v.id
                    and completed_at > now() - interval '10 seconds') then
    insert into horafit.video_views (user_id, company_id, video_id, video_title, watched_seconds, duration_seconds)
    values (s.user_id, s.company_id, v.id, v.title,
            round(p_watched_seconds, 1), round(p_duration_seconds, 1));
  end if;
  select count(*) into n from horafit.video_views where user_id = s.user_id and video_id = v.id;
  return json_build_object('times_completed', n);
end $$;

-- ---------------------------------------------------------------------
--  API del panel de administración
-- ---------------------------------------------------------------------
create or replace function public.hf_admin_login(p_username text, p_password text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare a horafit.admins; t text; k text := 'admin:' || lower(trim(coalesce(p_username,'')));
begin
  perform horafit.guard_attempts(k);
  select * into a from horafit.admins where lower(username) = lower(trim(p_username));
  if not found or not horafit.check_pw(p_password, a.password_hash) then
    perform horafit.fail_attempt(k);
    return json_build_object('error', 'El usuario o la contraseña de administración no son correctos.');
  end if;
  t := horafit.new_token();
  insert into horafit.sessions (token, kind, admin_id, expires_at)
  values (t, 'admin', a.id, now() + interval '12 hours');
  return json_build_object('token', t, 'username', a.username);
end $$;

create or replace function public.hf_admin_change_password(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare aid uuid := horafit.require_admin(p_token);
begin
  if not horafit.check_pw(p_old, (select password_hash from horafit.admins where id = aid)) then
    raise exception 'La contraseña actual no es correcta.';
  end if;
  perform horafit.check_password_rules(p_new);
  update horafit.admins set password_hash = horafit.hash_pw(p_new) where id = aid;
end $$;

create or replace function public.hf_admin_overview(p_token text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  return json_build_object(
    'companies', (select count(*) from horafit.companies),
    'users',     (select count(*) from horafit.users),
    'videos',    (select count(*) from horafit.videos where active),
    'views_total', (select count(*) from horafit.video_views),
    'views_7d',  (select count(*) from horafit.video_views where completed_at > now() - interval '7 days'));
end $$;

-- Empresas ------------------------------------------------------------
create or replace function public.hf_admin_companies(p_token text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  return coalesce((select json_agg(row_to_json(x) order by lower(x.name)) from (
    select c.id, c.name, c.active, c.created_at, c.logo,
           (select count(*) from horafit.users u where u.company_id = c.id) as users,
           (select count(*) from horafit.video_views w where w.company_id = c.id) as views
      from horafit.companies c) x), '[]'::json);
end $$;

-- Versión anterior sin logo (se elimina para que no haya dos funciones con el mismo nombre).
drop function if exists public.hf_admin_save_company(text, uuid, text, text, boolean);

-- p_logo: null = no cambiar · '' = quitar · 'data:image/...' = nuevo logo
create or replace function public.hf_admin_save_company(p_token text, p_id uuid, p_name text,
                                                        p_password text, p_active boolean, p_logo text default null) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare rid uuid;
begin
  perform horafit.require_admin(p_token);
  if coalesce(trim(p_name), '') = '' then raise exception 'Escribe el nombre de la empresa.'; end if;
  if coalesce(p_logo, '') <> '' then
    if p_logo !~ '^data:image/(png|jpeg|webp);base64,' then raise exception 'El logo debe ser una imagen PNG, JPG o WebP.'; end if;
    if length(p_logo) > 400000 then raise exception 'El logo es demasiado grande. Prueba con una imagen más sencilla.'; end if;
  end if;
  if exists (select 1 from horafit.companies
              where lower(name) = lower(trim(p_name)) and id is distinct from p_id) then
    raise exception 'Ya existe una empresa con ese nombre.';
  end if;
  if p_id is null then
    perform horafit.check_password_rules(p_password);
    insert into horafit.companies (name, password_hash, active, logo)
    values (trim(p_name), horafit.hash_pw(p_password), coalesce(p_active, true), nullif(p_logo, ''))
    returning id into rid;
  else
    if coalesce(p_password, '') <> '' then perform horafit.check_password_rules(p_password); end if;
    update horafit.companies set
      name = trim(p_name),
      active = coalesce(p_active, active),
      logo = case when p_logo is null then logo else nullif(p_logo, '') end,
      password_hash = case when coalesce(p_password,'') <> '' then horafit.hash_pw(p_password) else password_hash end
    where id = p_id returning id into rid;
    if rid is null then raise exception 'La empresa no existe.'; end if;
    -- Si cambia la contraseña o se desactiva, cierra las sesiones abiertas de esa empresa.
    if coalesce(p_password,'') <> '' or p_active is false then
      delete from horafit.sessions where company_id = rid;
    end if;
  end if;
  return json_build_object('id', rid);
end $$;

create or replace function public.hf_admin_delete_company(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  delete from horafit.companies where id = p_id;
end $$;

-- Usuarios ------------------------------------------------------------
create or replace function public.hf_admin_users(p_token text, p_company_id uuid) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  return coalesce((select json_agg(row_to_json(x) order by lower(x.username)) from (
    select u.id, u.company_id, u.username, u.display_name, u.active, u.created_at,
           (select count(*) from horafit.video_views w where w.user_id = u.id) as views,
           (select max(completed_at) from horafit.video_views w where w.user_id = u.id) as last_view_at
      from horafit.users u where u.company_id = p_company_id) x), '[]'::json);
end $$;

create or replace function public.hf_admin_save_user(p_token text, p_id uuid, p_company_id uuid, p_username text,
                                                     p_display_name text, p_password text, p_active boolean) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare rid uuid;
begin
  perform horafit.require_admin(p_token);
  if coalesce(trim(p_username), '') = '' then raise exception 'Escribe el nombre de usuario.'; end if;
  if p_id is null then
    if not exists (select 1 from horafit.companies where id = p_company_id) then
      raise exception 'La empresa no existe.';
    end if;
    if exists (select 1 from horafit.users where company_id = p_company_id and lower(username) = lower(trim(p_username))) then
      raise exception 'Esa empresa ya tiene un usuario con ese nombre.';
    end if;
    perform horafit.check_password_rules(p_password);
    insert into horafit.users (company_id, username, display_name, password_hash, active)
    values (p_company_id, trim(p_username), nullif(trim(p_display_name), ''), horafit.hash_pw(p_password), coalesce(p_active, true))
    returning id into rid;
  else
    if exists (select 1 from horafit.users o join horafit.users me on me.id = p_id
                where o.company_id = me.company_id and o.id <> p_id and lower(o.username) = lower(trim(p_username))) then
      raise exception 'Esa empresa ya tiene un usuario con ese nombre.';
    end if;
    if coalesce(p_password, '') <> '' then perform horafit.check_password_rules(p_password); end if;
    update horafit.users set
      username = trim(p_username),
      display_name = nullif(trim(p_display_name), ''),
      active = coalesce(p_active, active),
      password_hash = case when coalesce(p_password,'') <> '' then horafit.hash_pw(p_password) else password_hash end
    where id = p_id returning id into rid;
    if rid is null then raise exception 'El usuario no existe.'; end if;
    if coalesce(p_password,'') <> '' or p_active is false then
      delete from horafit.sessions where user_id = rid;
    end if;
  end if;
  return json_build_object('id', rid);
end $$;

create or replace function public.hf_admin_delete_user(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  delete from horafit.users where id = p_id;
end $$;

-- Vídeos --------------------------------------------------------------
create or replace function public.hf_admin_videos(p_token text) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  return coalesce((select json_agg(row_to_json(x) order by x.sort_order, x.title) from (
    select v.*, (select count(*) from horafit.video_views w where w.video_id = v.id) as views
      from horafit.videos v) x), '[]'::json);
end $$;

create or replace function public.hf_admin_save_video(p_token text, p_id uuid, p_title text, p_description text,
                                                      p_url text, p_category text, p_sort_order int, p_active boolean) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
declare rid uuid;
begin
  perform horafit.require_admin(p_token);
  if coalesce(trim(p_title), '') = '' then raise exception 'Escribe el título del vídeo.'; end if;
  if coalesce(trim(p_url), '') !~* '^https://' then raise exception 'El enlace del vídeo debe empezar por https://'; end if;
  if p_id is null then
    insert into horafit.videos (title, description, url, category, sort_order, active)
    values (trim(p_title), nullif(trim(p_description),''), trim(p_url), nullif(trim(p_category),''),
            coalesce(p_sort_order, 100), coalesce(p_active, true))
    returning id into rid;
  else
    update horafit.videos set title = trim(p_title), description = nullif(trim(p_description),''),
           url = trim(p_url), category = nullif(trim(p_category),''),
           sort_order = coalesce(p_sort_order, sort_order), active = coalesce(p_active, active)
     where id = p_id returning id into rid;
    if rid is null then raise exception 'El vídeo no existe.'; end if;
  end if;
  return json_build_object('id', rid);
end $$;

create or replace function public.hf_admin_delete_video(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  delete from horafit.videos where id = p_id;
end $$;

-- Registro de visualizaciones -----------------------------------------
create or replace function public.hf_admin_views(p_token text, p_company_id uuid, p_user_id uuid, p_video_id uuid,
                                                 p_from date, p_to date, p_limit int) returns json
language plpgsql security definer set search_path = horafit, extensions, public as $$
begin
  perform horafit.require_admin(p_token);
  return coalesce((select json_agg(row_to_json(x)) from (
    select w.id, w.completed_at, w.video_id, w.video_title, w.watched_seconds, w.duration_seconds,
           c.id as company_id, c.name as company_name,
           u.id as user_id, u.username, u.display_name
      from horafit.video_views w
      join horafit.companies c on c.id = w.company_id
      join horafit.users u on u.id = w.user_id
     where (p_company_id is null or w.company_id = p_company_id)
       and (p_user_id is null or w.user_id = p_user_id)
       and (p_video_id is null or w.video_id = p_video_id)
       and (p_from is null or w.completed_at >= p_from)
       and (p_to is null or w.completed_at < p_to + 1)
     order by w.completed_at desc
     limit least(coalesce(p_limit, 500), 5000)) x), '[]'::json);
end $$;

-- ---------------------------------------------------------------------
--  Permisos: solo las funciones hf_* se pueden llamar desde la web
-- ---------------------------------------------------------------------
revoke all on all tables    in schema horafit from public;
revoke all on all functions in schema horafit from public;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'hf\_%' loop
    execute format('revoke all on function %s from public', r.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Vídeos de ejemplo (solo si aún no hay ninguno). Cámbialos en el panel.
-- ---------------------------------------------------------------------
insert into horafit.videos (title, description, url, category, sort_order)
select * from (values
  ('Vídeo de prueba 1', 'Sustitúyelo por tu calentamiento desde el panel de administración.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 'Calentamiento', 10),
  ('Vídeo de prueba 2', 'Sustitúyelo por un ejercicio de movilidad.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', 'Movilidad', 20),
  ('Vídeo de prueba 3', 'Sustitúyelo por un ejercicio de fuerza.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', 'Fuerza', 30),
  ('Vídeo de prueba 4', 'Sustitúyelo por tus estiramientos finales.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', 'Estiramientos', 40)
) as v(title, description, url, category, sort_order)
where not exists (select 1 from horafit.videos);

-- =====================================================================
--  ÚLTIMO PASO: crea tu usuario de administración.
--  Cambia el nombre y la contraseña de la línea de abajo y ejecútala.
-- =====================================================================
-- select horafit.create_admin('admin', 'pon-aqui-una-contraseña-segura');
