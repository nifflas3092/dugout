-- Dugout database: run this once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Teams and who belongs to them, plus one flexible "docs" table that holds each team's data
-- (roster, games, RSVPs, at-bats, posts) and the league-wide sub list. Row-level security decides who can read and write what.

create extension if not exists pgcrypto;

-- people: one row per signed-in person, with the name others see
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- create a profile automatically when someone signs up
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- teams and membership
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  created_by uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  team_id uuid references public.teams on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'player' check (role in ('captain', 'player')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create or replace function public.is_member(t text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id::text = t and user_id = auth.uid());
$$;
create or replace function public.is_captain(t text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id::text = t and user_id = auth.uid() and role = 'captain');
$$;

create policy "members see their teams" on public.teams for select to authenticated using (public.is_member(id::text));
create policy "captains rename their teams" on public.teams for update to authenticated using (public.is_captain(id::text));
create policy "members see teammates" on public.team_members for select to authenticated using (public.is_member(team_id::text));
create policy "captains manage members" on public.team_members for update to authenticated using (public.is_captain(team_id::text));
create policy "captains remove members, anyone leaves" on public.team_members for delete to authenticated using (public.is_captain(team_id::text) or user_id = auth.uid());

-- start a team (you become its captain) and join one with its code
create or replace function public.create_team(team_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into teams (name, created_by) values (team_name, auth.uid()) returning id into tid;
  insert into team_members (team_id, user_id, role) values (tid, auth.uid(), 'captain');
  return tid;
end $$;
create or replace function public.join_team(code text) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select id into tid from teams where join_code = upper(trim(code));
  if tid is null then raise exception 'No team has that code'; end if;
  insert into team_members (team_id, user_id, role) values (tid, auth.uid(), 'player') on conflict do nothing;
  return tid;
end $$;
grant execute on function public.create_team(text), public.join_team(text) to authenticated;

-- the data. scope = a team id, or 'global' for the league-wide sub list (agents, diamonds, invites)
create table if not exists public.docs (
  scope text not null,
  col text not null,
  id text not null,
  data jsonb not null default '{}',
  owner uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (scope, col, id)
);
create index if not exists docs_scope_col on public.docs (scope, col);
alter table public.docs enable row level security;
alter table public.docs replica identity full; -- so live updates include deleted rows

-- reading: your teams' data, and the global sub list
create policy "read team or global" on public.docs for select to authenticated
  using ((scope = 'global' and col <> 'invites') or public.is_member(scope));
-- sub requests are private: only the captain who sent one and the sub it was sent to can see it
create policy "read own sub requests" on public.docs for select to authenticated
  using (scope = 'global' and col = 'invites' and (owner = auth.uid() or data->>'agent' = auth.uid()::text));

-- writing team data: players can RSVP and post; captains manage everything else
create policy "team writes" on public.docs for all to authenticated
  using (scope <> 'global' and (public.is_captain(scope) or (col in ('rsvp', 'posts') and public.is_member(scope))))
  with check (scope <> 'global' and (public.is_captain(scope) or (col in ('rsvp', 'posts') and public.is_member(scope))));

-- writing the sub list: your own sub profile only; any captain can add a diamond; requests go to or from you
create policy "own sub profile" on public.docs for all to authenticated
  using (scope = 'global' and col = 'agents' and id = auth.uid()::text)
  with check (scope = 'global' and col = 'agents' and id = auth.uid()::text);
create policy "add diamonds" on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'diamonds' and exists (select 1 from team_members where user_id = auth.uid() and role = 'captain'));
create policy "change own diamonds" on public.docs for update to authenticated
  using (scope = 'global' and col = 'diamonds' and owner = auth.uid());
create policy "send sub requests" on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'invites' and exists (select 1 from team_members where user_id = auth.uid() and role = 'captain'));
create policy "answer or edit sub requests" on public.docs for update to authenticated
  using (scope = 'global' and col = 'invites' and (owner = auth.uid() or data->>'agent' = auth.uid()::text));
create policy "delete own docs" on public.docs for delete to authenticated
  using (scope = 'global' and owner = auth.uid());

-- keep updated_at fresh and stop people changing who owns a row
create or replace function public.touch_doc() returns trigger language plpgsql as $$
begin new.updated_at = now(); if tg_op = 'UPDATE' then new.owner = old.owner; end if; return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.touch_doc();

-- merge a few fields into a doc (row-level security still applies, because it runs as the caller)
create or replace function public.doc_update(p_scope text, p_col text, p_id text, patch jsonb) returns void language plpgsql security invoker set search_path = public as $$
begin
  update docs set data = data || patch where scope = p_scope and col = p_col and id = p_id;
  if not found then raise exception 'Not found or not allowed'; end if;
end $$;
grant execute on function public.doc_update(text, text, text, jsonb) to authenticated;

-- live updates
alter publication supabase_realtime add table public.docs;
