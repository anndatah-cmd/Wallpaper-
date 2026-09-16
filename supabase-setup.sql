-- ============================================================
-- Backdrop — Supabase setup
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query
-- ============================================================

-- 1. PROFILES ---------------------------------------------------
-- One row per user. is_admin controls access to the admin panel.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper used inside RLS policies below.
create or replace function public.is_admin(uid uuid)
returns boolean as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$ language sql stable security definer set search_path = public;

-- 2. WALLPAPERS ---------------------------------------------------
create table if not exists public.wallpapers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text default 'uncategorized',
  storage_path text not null,      -- path inside the private "wallpapers" bucket
  thumbnail_path text not null,    -- path inside the public "thumbnails" bucket
  width int,
  height int,
  download_count int not null default 0,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.wallpapers enable row level security;

create policy "Anyone can view wallpaper metadata"
  on public.wallpapers for select
  using (true);

create policy "Admins can insert wallpapers"
  on public.wallpapers for insert
  with check (public.is_admin(auth.uid()));

create policy "Admins can update wallpapers"
  on public.wallpapers for update
  using (public.is_admin(auth.uid()));

create policy "Admins can delete wallpapers"
  on public.wallpapers for delete
  using (public.is_admin(auth.uid()));

-- Bump the download counter (called by the client after a successful download).
create or replace function public.increment_downloads(wallpaper_id uuid)
returns void as $$
  update public.wallpapers set download_count = download_count + 1 where id = wallpaper_id;
$$ language sql security definer set search_path = public;

grant execute on function public.increment_downloads(uuid) to authenticated;

-- 3. STORAGE BUCKETS ---------------------------------------------------
-- "thumbnails" is public so the gallery can render previews without login.
-- "wallpapers" is private so full-resolution files require a logged-in user.
insert into storage.buckets (id, name, public)
  values ('thumbnails', 'thumbnails', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('wallpapers', 'wallpapers', false)
  on conflict (id) do nothing;

create policy "Public can view thumbnails"
  on storage.objects for select
  using (bucket_id = 'thumbnails');

create policy "Admins can upload thumbnails"
  on storage.objects for insert
  with check (bucket_id = 'thumbnails' and public.is_admin(auth.uid()));

create policy "Admins can delete thumbnails"
  on storage.objects for delete
  using (bucket_id = 'thumbnails' and public.is_admin(auth.uid()));

create policy "Logged-in users can view full wallpapers"
  on storage.objects for select
  using (bucket_id = 'wallpapers' and auth.role() = 'authenticated');

create policy "Admins can upload wallpapers"
  on storage.objects for insert
  with check (bucket_id = 'wallpapers' and public.is_admin(auth.uid()));

create policy "Admins can delete wallpapers"
  on storage.objects for delete
  using (bucket_id = 'wallpapers' and public.is_admin(auth.uid()));

-- ============================================================
-- After running this:
-- 1. Sign up once through the live site (index.html) with the email
--    you want to use as the admin.
-- 2. Come back here and run:
--      update public.profiles set is_admin = true where email = 'you@example.com';
-- 3. That account can now sign in at admin.html and upload wallpapers.
-- ============================================================
