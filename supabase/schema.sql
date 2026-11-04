-- Dugout database. Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: it drops and recreates its own policies and functions.
--
-- Security model, in plain words:
--   * Nobody who isn't signed in can read or write anything.
--   * Team data is visible only to that team's members. Captains change the roster, games, lineups and scores.
--     Players can answer RSVPs only for the roster spot they've claimed as theirs, and post or delete their own board posts.
--   * The sub list is visible to every signed-in user, but a sub's contact details are shown only to a captain
--     whose request they accepted.
--   * Every write is checked by the database itself (row-level security + validation triggers), not just by the app,
--     because anyone can call the database directly with the public key.
--   * Privileged functions run with an empty search_path, check who's calling, and can't be called by signed-out users.


---------------------------------------------------------------------------
-- tables
---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  join_code text not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid references public.teams on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'player' check (role in ('captain', 'player')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user on public.team_members (user_id);

-- failed and successful join attempts, so team codes can't be guessed by trying millions of them
create table if not exists public.join_attempts (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user_at on public.join_attempts (user_id, at);

-- one row per person: what they've paid for, and their private calendar link.
-- Only the payment webhook (running with the service key) changes plans; people can read their own row.
create table if not exists public.accounts (
  user_id uuid primary key references auth.users on delete cascade,
  captain_status text not null default 'none' check (captain_status in ('none', 'active', 'trialing', 'past_due', 'canceled')),
  captain_until timestamptz,
  grandfathered boolean not null default false,       -- captains from before paid plans keep captain tools free
  ad_free boolean not null default false,
  stripe_customer text,
  cal_token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);
create table if not exists public.app_flags (key text primary key, at timestamptz not null default now());
-- AI schedule imports, for a daily limit
create table if not exists public.import_log (user_id uuid not null references auth.users on delete cascade, at timestamptz not null default now());
create index if not exists import_log_user_at on public.import_log (user_id, at);

-- all app data. scope = a team id, or 'global' for the league-wide sub list
create table if not exists public.docs (
  scope text not null,
  col text not null,
  id text not null,
  data jsonb not null default '{}',
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, col, id),
  constraint docs_id_format check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint docs_col_known check (col in ('team', 'players', 'games', 'rsvp', 'ab', 'posts', 'chat', 'agents', 'contacts', 'diamonds', 'invites', 'listings', 'threads', 'messages', 'reports')),
  constraint docs_scope_matches check ((scope = 'global') = (col in ('agents', 'contacts', 'diamonds', 'invites', 'listings', 'threads', 'messages', 'reports'))),
  constraint docs_is_object check (jsonb_typeof(data) = 'object'),
  constraint docs_size check (pg_column_size(data) <= 32768)
);
-- upgrading from the first version of this file
alter table public.docs add column if not exists created_at timestamptz not null default now();
alter table public.docs alter column owner drop default;
alter table public.teams alter column join_code drop default;
alter table public.teams alter column created_by drop default;
drop function if exists public.touch_doc() cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'docs_id_format') then
    alter table public.docs add constraint docs_id_format check (id ~ '^[A-Za-z0-9_-]{1,80}$') not valid,
      add constraint docs_col_known check (col in ('team', 'players', 'games', 'rsvp', 'ab', 'posts', 'chat', 'agents', 'contacts', 'diamonds', 'invites', 'listings', 'threads', 'messages', 'reports')) not valid,
      add constraint docs_scope_matches check ((scope = 'global') = (col in ('agents', 'contacts', 'diamonds', 'invites', 'listings', 'threads', 'messages', 'reports'))) not valid,
      add constraint docs_is_object check (jsonb_typeof(data) = 'object') not valid,
      add constraint docs_size check (pg_column_size(data) <= 32768) not valid;
  end if;
end $$;
-- the lists of collections grow as features are added: rebuild those two checks every run
alter table public.docs drop constraint if exists docs_col_known, drop constraint if exists docs_scope_matches;
alter table public.docs add constraint docs_col_known check (col in ('team', 'players', 'games', 'rsvp', 'ab', 'posts', 'chat', 'agents', 'contacts', 'diamonds', 'invites', 'listings', 'threads', 'messages', 'reports')),
  add constraint docs_scope_matches check ((scope = 'global') = (col in ('agents', 'contacts', 'diamonds', 'invites', 'listings', 'threads', 'messages', 'reports')));
-- move any contact details out of sub profiles into the private contacts collection
insert into public.docs (scope, col, id, data, owner)
  select 'global', 'contacts', id, jsonb_build_object('contact', data->>'contact'), owner from public.docs
  where scope = 'global' and col = 'agents' and coalesce(data->>'contact', '') <> '' on conflict do nothing;
update public.docs set data = data - 'contact' where scope = 'global' and col = 'agents' and data ? 'contact';

create index if not exists docs_scope_col on public.docs (scope, col);
create index if not exists docs_owner_created on public.docs (owner, created_at);
create index if not exists docs_invite_agent on public.docs ((data->>'agent')) where col = 'invites';
alter table public.docs replica identity full;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.join_attempts enable row level security;
alter table public.docs enable row level security;
alter table public.accounts enable row level security;
alter table public.app_flags enable row level security;
alter table public.import_log enable row level security;

-- signed-out visitors get nothing; signed-in users get only what the policies below allow
-- (Supabase grants every new table to anon and authenticated by default, so take it all back first, then grant only what's needed)
revoke all on public.profiles, public.teams, public.team_members, public.join_attempts, public.docs, public.accounts, public.app_flags, public.import_log from anon, authenticated, public;
grant select on public.accounts to authenticated;
grant select, insert, delete on public.docs to authenticated;
grant update (scope, col, id, data) on public.docs to authenticated;  -- the key columns are needed for upserts; a trigger stops them changing
grant select on public.teams to authenticated;
grant update (name) on public.teams to authenticated;
grant select, delete on public.team_members to authenticated;
grant update (role) on public.team_members to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
-- join_attempts: no direct access at all; only the join_team function touches it

---------------------------------------------------------------------------
-- helpers (security definer so policies can look up membership without recursion)
---------------------------------------------------------------------------
create or replace function public.is_member(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.team_id::text = t and m.user_id = (select auth.uid()));
$$;
create or replace function public.is_captain(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.team_id::text = t and m.user_id = (select auth.uid()) and m.role = 'captain');
$$;
create or replace function public.is_any_captain() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.user_id = (select auth.uid()) and m.role = 'captain');
$$;
-- has this person got captain tools? an active $5/month plan, or a captain from before paid plans
create or replace function public.is_paid_captain() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accounts a where a.user_id = (select auth.uid())
                 and (a.grandfathered or (a.captain_status in ('active', 'trialing') and (a.captain_until is null or a.captain_until > now() - interval '3 days'))));
$$;
create or replace function public.shares_team(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members a join public.team_members b on a.team_id = b.team_id
                 where a.user_id = (select auth.uid()) and b.user_id = other);
$$;
-- may this user see this sub's contact details? only after they said yes to one of your requests
create or replace function public.contact_unlocked(agent text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.docs d where d.scope = 'global' and d.col = 'invites'
                 and d.owner = (select auth.uid()) and d.data->>'agent' = agent and d.data->>'status' = 'accepted');
$$;
-- is this roster spot claimed by the current user?
create or replace function public.owns_player(t text, player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.docs d where d.scope = t and d.col = 'players' and d.id = player
                 and d.data->>'uid' = (select auth.uid())::text);
$$;
-- marketplace: is the current user the buyer or seller in this conversation?
create or replace function public.in_thread(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.docs d where d.scope = 'global' and d.col = 'threads' and d.id = t
                 and (d.data->>'buyer' = (select auth.uid())::text or d.data->>'seller' = (select auth.uid())::text));
$$;
create or replace function public.new_join_code() returns text
language sql volatile set search_path = '' as $$
  -- 8 characters from 31 unambiguous letters and digits (no 0/O, 1/I/L): about 850 billion combinations
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 31), 1), '')
  from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 7) i;  -- built-in secure randomness, no extension needed
$$;

---------------------------------------------------------------------------
-- row-level security policies
---------------------------------------------------------------------------
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('profiles', 'teams', 'team_members', 'join_attempts', 'docs', 'accounts', 'app_flags', 'import_log') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: you, and people on a team with you
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_team(id));
create policy profiles_edit_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- teams: members see them; captains rename them. Creating and joining go through functions below.
create policy teams_read on public.teams for select to authenticated using (public.is_member(id::text));
create policy teams_rename on public.teams for update to authenticated
  using (public.is_captain(id::text)) with check (public.is_captain(id::text));

-- team members
create policy members_read on public.team_members for select to authenticated using (public.is_member(team_id::text));
create policy members_set_role on public.team_members for update to authenticated
  using (public.is_captain(team_id::text)) with check (public.is_captain(team_id::text));
create policy members_remove on public.team_members for delete to authenticated
  using (public.is_captain(team_id::text) or user_id = (select auth.uid()));

-- docs: reading
create policy docs_read_team on public.docs for select to authenticated
  using (scope <> 'global' and public.is_member(scope));
create policy docs_read_diamonds on public.docs for select to authenticated
  using (scope = 'global' and col = 'diamonds');
-- the master list of subs is a captain feature; everyone can see their own sub profile
create policy docs_read_sub_list on public.docs for select to authenticated
  using (scope = 'global' and col = 'agents' and (id = (select auth.uid())::text or public.is_paid_captain()));
create policy accounts_read_own on public.accounts for select to authenticated using (user_id = (select auth.uid()));
create policy docs_read_contacts on public.docs for select to authenticated
  using (scope = 'global' and col = 'contacts' and (id = (select auth.uid())::text or public.contact_unlocked(id)));
create policy docs_read_invites on public.docs for select to authenticated
  using (scope = 'global' and col = 'invites' and (owner = (select auth.uid()) or data->>'agent' = (select auth.uid())::text));

-- docs: captains manage their team's data
create policy docs_captain_insert on public.docs for insert to authenticated
  with check (scope <> 'global' and public.is_captain(scope));
create policy docs_captain_update on public.docs for update to authenticated
  using (scope <> 'global' and public.is_captain(scope)) with check (scope <> 'global' and public.is_captain(scope));
create policy docs_captain_delete on public.docs for delete to authenticated
  using (scope <> 'global' and public.is_captain(scope));

-- docs: players answer RSVPs for their own roster spot
create policy docs_rsvp_insert on public.docs for insert to authenticated
  with check (col = 'rsvp' and public.is_member(scope) and public.owns_player(scope, data->>'p'));
create policy docs_rsvp_update on public.docs for update to authenticated
  using (col = 'rsvp' and public.is_member(scope) and public.owns_player(scope, data->>'p'))
  with check (col = 'rsvp' and public.is_member(scope) and public.owns_player(scope, data->>'p'));

-- docs: players post on the board and delete their own posts (captains can delete or pin any)
create policy docs_post_insert on public.docs for insert to authenticated
  with check (col = 'posts' and public.is_member(scope));
create policy docs_post_delete_own on public.docs for delete to authenticated
  using (col = 'posts' and owner = (select auth.uid()));

-- docs: the gear marketplace. Listings are public to signed-in users; conversations only to the two people in them.
create policy docs_read_listings on public.docs for select to authenticated
  using (scope = 'global' and col = 'listings');
create policy docs_listing_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'listings');
create policy docs_listing_update on public.docs for update to authenticated
  using (scope = 'global' and col = 'listings' and owner = (select auth.uid()))
  with check (scope = 'global' and col = 'listings');
create policy docs_listing_delete on public.docs for delete to authenticated
  using (scope = 'global' and col = 'listings' and owner = (select auth.uid()));
create policy docs_read_threads on public.docs for select to authenticated
  using (scope = 'global' and col = 'threads' and (data->>'buyer' = (select auth.uid())::text or data->>'seller' = (select auth.uid())::text));
create policy docs_thread_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'threads' and data->>'buyer' = (select auth.uid())::text);
create policy docs_read_messages on public.docs for select to authenticated
  using (scope = 'global' and col = 'messages' and public.in_thread(data->>'thread'));
create policy docs_message_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'messages' and public.in_thread(data->>'thread'));
create policy docs_report_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'reports');
-- (no one can read reports through the app; review them in the Supabase dashboard)

-- docs: team chat. Members talk; anyone can delete their own message, captains any
create policy docs_chat_insert on public.docs for insert to authenticated
  with check (col = 'chat' and public.is_member(scope));
create policy docs_chat_delete_own on public.docs for delete to authenticated
  using (col = 'chat' and owner = (select auth.uid()));

-- docs: the sub list
create policy docs_own_profile_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col in ('agents', 'contacts') and id = (select auth.uid())::text);
create policy docs_own_profile_update on public.docs for update to authenticated
  using (scope = 'global' and col in ('agents', 'contacts') and id = (select auth.uid())::text)
  with check (scope = 'global' and col in ('agents', 'contacts') and id = (select auth.uid())::text);
create policy docs_own_profile_delete on public.docs for delete to authenticated
  using (scope = 'global' and col in ('agents', 'contacts') and id = (select auth.uid())::text);

create policy docs_diamond_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'diamonds' and public.is_any_captain());
create policy docs_diamond_own on public.docs for update to authenticated
  using (scope = 'global' and col = 'diamonds' and owner = (select auth.uid()))
  with check (scope = 'global' and col = 'diamonds');
create policy docs_diamond_delete on public.docs for delete to authenticated
  using (scope = 'global' and col = 'diamonds' and owner = (select auth.uid()));

create policy docs_invite_insert on public.docs for insert to authenticated
  with check (scope = 'global' and col = 'invites' and public.is_paid_captain());
create policy docs_invite_update on public.docs for update to authenticated
  using (scope = 'global' and col = 'invites' and (owner = (select auth.uid()) or data->>'agent' = (select auth.uid())::text))
  with check (scope = 'global' and col = 'invites');
create policy docs_invite_delete on public.docs for delete to authenticated
  using (scope = 'global' and col = 'invites' and owner = (select auth.uid()));

---------------------------------------------------------------------------
-- validation: runs on every write, whoever makes it
---------------------------------------------------------------------------
create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  recent int;
  t text;
  recent_title text;
begin
  if tg_op = 'UPDATE' then
    if new.scope <> old.scope or new.col <> old.col or new.id <> old.id then raise exception 'Documents can''t be moved'; end if;
    new.owner := old.owner; new.created_at := old.created_at;
  else
    new.owner := me; new.created_at := now();
    -- flood protection: 120 new documents a minute per person is far beyond real use (scoring a game is ~1 every 20 s)
    if me is not null then
      select count(*) into recent from public.docs where owner = me and created_at > now() - interval '1 minute';
      if recent >= 120 then raise exception 'Too many changes too fast. Wait a minute.'; end if;
    end if;
  end if;
  new.updated_at := now();

  if new.col = 'team' then
    if new.id <> 'info' then raise exception 'Bad team document'; end if;
    if char_length(coalesce(new.data->>'name', '')) not between 1 and 40 then raise exception 'Team name is 1 to 40 characters'; end if;
    update public.teams set name = new.data->>'name' where id::text = new.scope and name is distinct from new.data->>'name';
    if jsonb_typeof(new.data->'lat') = 'number' and jsonb_typeof(new.data->'lng') = 'number' then
      new.data := new.data || jsonb_build_object('lat', round((new.data->>'lat')::numeric, 2), 'lng', round((new.data->>'lng')::numeric, 2));
    end if;

  elsif new.col = 'players' then
    -- which account a roster spot belongs to can only change through claim_player / unclaim_player
    if coalesce(current_setting('dugout.claiming', true), '') <> 'on' then
      new.data := new.data - 'uid';
      if tg_op = 'UPDATE' and old.data ? 'uid' then new.data := new.data || jsonb_build_object('uid', old.data->'uid'); end if;
    end if;
    if char_length(coalesce(new.data->>'name', '')) > 40 then raise exception 'Name too long'; end if;

  elsif new.col = 'rsvp' then
    if new.id <> (new.data->>'g') || '_' || (new.data->>'p') then raise exception 'Bad RSVP'; end if;
    if coalesce(new.data->>'s', '') not in ('in', 'maybe', 'out') then raise exception 'Bad RSVP'; end if;

  elsif new.col = 'posts' then
    if tg_op = 'UPDATE' and not public.is_captain(new.scope) then raise exception 'Only captains can edit posts'; end if;
    new.data := jsonb_set(new.data, '{u}', to_jsonb(coalesce(new.owner, me)::text));
    if char_length(coalesce(new.data->>'text', '')) not between 1 and 600 then raise exception 'Posts are 1 to 600 characters'; end if;

  elsif new.col = 'agents' then
    new.data := new.data - 'contact';            -- contact details live in the separate, locked-down contacts collection
    if char_length(coalesce(new.data->>'name', '')) not between 1 and 40 then raise exception 'Name is 1 to 40 characters'; end if;
    if char_length(coalesce(new.data->>'about', '')) > 500 then raise exception 'About is up to 500 characters'; end if;
    -- everyone signed in sees the sub list, so accept only the shapes the app produces
    if coalesce(new.data->>'gender', '') not in ('', 'w', 'm', 'x')
       or coalesce(new.data->>'bats', 'R') not in ('R', 'L', 'S') or coalesce(new.data->>'throws', 'R') not in ('R', 'L')
       or coalesce(new.data->>'skill', '1') !~ '^[1-5]$' or coalesce(new.data->>'radius', '15') !~ '^[0-9]{1,3}$'
       or char_length(coalesce(new.data->>'area', '')) > 80
       or jsonb_typeof(coalesce(new.data->'active', 'true')) <> 'boolean' or jsonb_typeof(coalesce(new.data->'hideOnline', 'false')) <> 'boolean'
       or jsonb_typeof(coalesce(new.data->'pos', '[]')) <> 'array' or jsonb_typeof(coalesce(new.data->'days', '[]')) <> 'array'
       or jsonb_typeof(coalesce(new.data->'times', '[]')) <> 'array' or jsonb_typeof(coalesce(new.data->'str', '[]')) <> 'array'
       or jsonb_typeof(coalesce(new.data->'weak', '[]')) <> 'array'
       or exists (select 1 from jsonb_array_elements(coalesce(new.data->'pos', '[]')) x where x #>> '{}' not in ('P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF'))
       or exists (select 1 from jsonb_array_elements(coalesce(new.data->'days', '[]')) x where x #>> '{}' not in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'))
       or exists (select 1 from jsonb_array_elements(coalesce(new.data->'times', '[]')) x where x #>> '{}' not in ('early', 'evening', 'late'))
       or jsonb_array_length(coalesce(new.data->'str', '[]')) > 12 or jsonb_array_length(coalesce(new.data->'weak', '[]')) > 12
       or exists (select 1 from jsonb_array_elements(coalesce(new.data->'str', '[]') || coalesce(new.data->'weak', '[]')) x
                  where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 40)
    then raise exception 'Some of the profile details aren''t valid'; end if;
    if jsonb_typeof(new.data->'lat') = 'number' and jsonb_typeof(new.data->'lng') = 'number' then
      -- store location rounded to about 1 km, whatever the app sends
      new.data := new.data || jsonb_build_object('lat', round((new.data->>'lat')::numeric, 2), 'lng', round((new.data->>'lng')::numeric, 2));
    else
      new.data := new.data - 'lat' - 'lng';
    end if;

  elsif new.col = 'contacts' then
    new.data := jsonb_build_object('contact', left(coalesce(new.data->>'contact', ''), 200));

  elsif new.col = 'diamonds' then
    if char_length(coalesce(new.data->>'name', '')) not between 1 and 60 then raise exception 'Diamond name is 1 to 60 characters'; end if;
    if jsonb_typeof(new.data->'lat') <> 'number' or jsonb_typeof(new.data->'lng') <> 'number' then raise exception 'Diamond needs a location'; end if;

  elsif new.col = 'listings' then
    if tg_op = 'INSERT' then
      select count(*) into recent from public.docs where owner = me and col = 'listings' and created_at > now() - interval '1 day';
      if recent >= 15 then raise exception 'That''s a lot of listings for one day. Try again tomorrow.'; end if;
    end if;
    if char_length(coalesce(new.data->>'title', '')) not between 3 and 60 then raise exception 'Give it a title (3 to 60 characters)'; end if;
    if char_length(coalesce(new.data->>'desc', '')) > 1000 then raise exception 'Description is up to 1000 characters'; end if;
    if coalesce(new.data->>'cat', '') not in ('bat', 'glove', 'cleats', 'helmet', 'bag', 'balls', 'catcher', 'apparel', 'training', 'other')
       or coalesce(new.data->>'cond', '') not in ('new', 'likenew', 'good', 'fair', 'worn')
       or coalesce(new.data->>'status', 'active') not in ('active', 'pending', 'sold')
       or coalesce(new.data->>'cert', '') not in ('', 'usa', 'usssa', 'isf', 'nsa', 'multi', 'none')
       or coalesce(new.data->>'price', '') !~ '^[0-9]{1,4}$'
       or char_length(coalesce(new.data->>'size', '')) > 30 or char_length(coalesce(new.data->>'brand', '')) > 30
       or char_length(coalesce(new.data->>'area', '')) > 80
    then raise exception 'Some of the listing details aren''t valid'; end if;
    -- photos: up to 4, and only files in the seller's own folder for this listing (never outside links)
    if jsonb_typeof(coalesce(new.data->'photos', '[]')) <> 'array' or jsonb_array_length(coalesce(new.data->'photos', '[]')) > 4
       or exists (select 1 from jsonb_array_elements(coalesce(new.data->'photos', '[]')) x
                  where x #>> '{}' !~ ('^' || coalesce(new.owner, me)::text || '/' || new.id || '/[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$'))
    then raise exception 'Photos must be uploaded from the app'; end if;
    if jsonb_typeof(new.data->'lat') = 'number' and jsonb_typeof(new.data->'lng') = 'number' then
      new.data := new.data || jsonb_build_object('lat', round((new.data->>'lat')::numeric, 2), 'lng', round((new.data->>'lng')::numeric, 2));
    else
      new.data := new.data - 'lat' - 'lng';
    end if;
    new.data := new.data || jsonb_build_object('seller', coalesce(new.owner, me)::text);

  elsif new.col = 'threads' then
    if tg_op = 'INSERT' then
      select count(*) into recent from public.docs where owner = me and col = 'threads' and created_at > now() - interval '1 hour';
      if recent >= 20 then raise exception 'You''ve messaged a lot of sellers this hour. Try again later.'; end if;
      -- one conversation per buyer per listing; the seller and title come from the listing itself
      if new.id <> (new.data->>'listing') || '_' || me::text then raise exception 'Bad conversation'; end if;
      select d.owner::text, d.data->>'title' into t, recent_title from public.docs d where d.scope = 'global' and d.col = 'listings' and d.id = new.data->>'listing';
      if t is null then raise exception 'That listing is gone'; end if;
      if t = me::text then raise exception 'That''s your own listing'; end if;
      new.data := jsonb_build_object('listing', new.data->>'listing', 'buyer', me::text, 'seller', t, 'title', recent_title,
                                     'at', (extract(epoch from now()) * 1000)::bigint);
    else
      -- only the system updates a conversation (last message, read markers); the people in it never change
      new.data := new.data || jsonb_build_object('listing', old.data->'listing', 'buyer', old.data->'buyer', 'seller', old.data->'seller',
                                                 'title', old.data->'title', 'at', old.data->'at');
    end if;

  elsif new.col = 'messages' then
    if tg_op = 'UPDATE' then raise exception 'Messages can''t be edited'; end if;
    select count(*) into recent from public.docs where owner = me and col = 'messages' and created_at > now() - interval '10 minutes';
    if recent >= 60 then raise exception 'Slow down a little. Try again in a few minutes.'; end if;
    if char_length(coalesce(new.data->>'text', '')) not between 1 and 1000 then raise exception 'Messages are 1 to 1000 characters'; end if;
    new.data := jsonb_build_object('thread', new.data->>'thread', 'text', new.data->>'text', 'from', me::text,
                                   'at', (extract(epoch from now()) * 1000)::bigint);

  elsif new.col = 'chat' then
    if tg_op = 'UPDATE' then raise exception 'Messages can''t be edited'; end if;
    select count(*) into recent from public.docs where owner = me and col in ('chat', 'messages') and created_at > now() - interval '10 minutes';
    if recent >= 80 then raise exception 'Slow down a little. Try again in a few minutes.'; end if;
    if char_length(coalesce(new.data->>'text', '')) not between 1 and 1000 then raise exception 'Messages are 1 to 1000 characters'; end if;
    new.data := jsonb_build_object('text', new.data->>'text', 'u', me::text, 'at', (extract(epoch from now()) * 1000)::bigint);

  elsif new.col = 'reports' then
    if tg_op = 'UPDATE' then raise exception 'Reports can''t be edited'; end if;
    select count(*) into recent from public.docs where owner = me and col = 'reports' and created_at > now() - interval '1 day';
    if recent >= 10 then raise exception 'Thanks, we have your reports. Try again tomorrow.'; end if;
    if coalesce(new.data->>'reason', '') not in ('scam', 'prohibited', 'offensive', 'wrong', 'other') then raise exception 'Pick a reason'; end if;
    new.data := jsonb_build_object('listing', left(new.data->>'listing', 80), 'reason', new.data->>'reason',
                                   'note', left(coalesce(new.data->>'note', ''), 300), 'by', me::text, 'at', (extract(epoch from now()) * 1000)::bigint);

  elsif new.col = 'invites' then
    if tg_op = 'INSERT' then
      select count(*) into recent from public.docs where owner = me and col = 'invites' and created_at > now() - interval '1 hour';
      if recent >= 30 then raise exception 'That''s a lot of requests. Try again in an hour.'; end if;
      if not public.is_captain(new.data->>'teamId') then raise exception 'You can only ask on behalf of a team you captain'; end if;
      select name into t from public.teams where id::text = new.data->>'teamId';
      if not exists (select 1 from public.docs a where a.scope = 'global' and a.col = 'agents' and a.id = new.data->>'agent') then raise exception 'That sub isn''t on the list'; end if;
      new.data := new.data || jsonb_build_object('team', t, 'by', me::text, 'status', 'pending', 'at', (extract(epoch from now()) * 1000)::bigint);
      new.data := new.data - 'answeredAt';
      if char_length(coalesce(new.data->>'note', '')) > 300 then raise exception 'Message is up to 300 characters'; end if;
    elsif me is not null and old.data->>'agent' = me::text and old.owner is distinct from me then
      -- the sub answering: they can only change their answer
      if coalesce(new.data->>'status', '') not in ('accepted', 'declined') then raise exception 'Bad answer'; end if;
      new.data := old.data || jsonb_build_object('status', new.data->>'status', 'answeredAt', (extract(epoch from now()) * 1000)::bigint);
    else
      -- the captain who sent it: can edit the note, never the answer, the sub or the team
      new.data := new.data || jsonb_build_object('status', old.data->'status', 'agent', old.data->'agent', 'team', old.data->'team',
                                                 'teamId', old.data->'teamId', 'by', old.data->'by', 'at', old.data->'at');
      if old.data ? 'answeredAt' then new.data := new.data || jsonb_build_object('answeredAt', old.data->'answeredAt'); else new.data := new.data - 'answeredAt'; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.docs_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- removing someone from the roster frees their RSVPs too
  if old.col = 'players' then delete from public.docs where scope = old.scope and col = 'rsvp' and data->>'p' = old.id; end if;
  return old;
end $$;

create or replace function public.docs_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare th record;
begin
  if new.col = 'messages' then
    select data into th from public.docs where scope = 'global' and col = 'threads' and id = new.data->>'thread';
    update public.docs set data = data || jsonb_build_object('last', left(new.data->>'text', 80), 'lastAt', new.data->'at', 'lastFrom', new.data->'from',
        case when new.data->>'from' = th.data->>'buyer' then 'seenBuyer' else 'seenSeller' end, new.data->'at')
      where scope = 'global' and col = 'threads' and id = new.data->>'thread';
  end if;
  return new;
end $$;
drop trigger if exists docs_after_insert on public.docs;
create trigger docs_after_insert after insert on public.docs for each row execute function public.docs_after_insert();

-- "I've read this conversation"
create or replace function public.mark_thread_seen(p_thread text) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := (select auth.uid())::text; th jsonb;
begin
  select data into th from public.docs where scope = 'global' and col = 'threads' and id = p_thread;
  if th is null or me is null or (th->>'buyer' <> me and th->>'seller' <> me) then raise exception 'Not your conversation'; end if;
  update public.docs set data = data || jsonb_build_object(case when th->>'buyer' = me then 'seenBuyer' else 'seenSeller' end, (extract(epoch from now()) * 1000)::bigint)
    where scope = 'global' and col = 'threads' and id = p_thread;
end $$;

drop trigger if exists docs_touch on public.docs;
drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before insert or update on public.docs for each row execute function public.docs_guard();
drop trigger if exists docs_after_delete on public.docs;
create trigger docs_after_delete after delete on public.docs for each row execute function public.docs_after_delete();

-- a team always keeps at least one captain while it has members
create or replace function public.keep_a_captain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'captain' or (tg_op = 'UPDATE' and new.role = 'captain') then return coalesce(new, old); end if;
  if not exists (select 1 from public.teams where id = old.team_id) then return coalesce(new, old); end if; -- whole team being deleted
  if exists (select 1 from public.team_members where team_id = old.team_id and role = 'captain' and user_id <> old.user_id) then return coalesce(new, old); end if;
  if not exists (select 1 from public.team_members where team_id = old.team_id and user_id <> old.user_id) then return coalesce(new, old); end if;
  raise exception 'Make someone else a captain first';
end $$;
drop trigger if exists keep_a_captain on public.team_members;
create trigger keep_a_captain before update or delete on public.team_members for each row execute function public.keep_a_captain();

-- when the last member leaves, the team and its data go too
create or replace function public.cleanup_empty_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.teams where id = old.team_id) and not exists (select 1 from public.team_members where team_id = old.team_id) then
    delete from public.docs where scope = old.team_id::text;
    delete from public.teams where id = old.team_id;
  end if;
  -- give their roster spot back
  perform set_config('dugout.claiming', 'on', true);
  update public.docs set data = data - 'uid' where scope = old.team_id::text and col = 'players' and data->>'uid' = old.user_id::text;
  perform set_config('dugout.claiming', '', true);
  return old;
end $$;
drop trigger if exists cleanup_empty_team on public.team_members;
create trigger cleanup_empty_team after delete on public.team_members for each row execute function public.cleanup_empty_team();

---------------------------------------------------------------------------
-- actions the app calls
---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1), ''), 40))
  on conflict (id) do nothing;
  insert into public.accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.accounts (user_id) select id from auth.users on conflict (user_id) do nothing;
-- the first time paid plans switch on, everyone who is already a captain keeps captain tools for free
do $$ begin
  if not exists (select 1 from public.app_flags where key = 'grandfathered') then
    update public.accounts set grandfathered = true where user_id in (select user_id from public.team_members where role = 'captain');
    insert into public.app_flags (key) values ('grandfathered');
  end if;
end $$;

create or replace function public.create_team(team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); tid uuid; n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not public.is_paid_captain() then raise exception 'Starting a team is a captain feature. Upgrade to captain first.'; end if;
  select count(*) into n from public.team_members where user_id = me;
  if n >= 20 then raise exception 'You''re on a lot of teams already'; end if;
  insert into public.teams (name, join_code, created_by) values (left(trim(team_name), 40), public.new_join_code(), me) returning id into tid;
  insert into public.team_members (team_id, user_id, role) values (tid, me, 'captain');
  insert into public.docs (scope, col, id, data, owner) values (tid::text, 'team', 'info',
    jsonb_build_object('name', left(trim(team_name), 40), 'league', '', 'season', '', 'fee', 0, 'innings', 7), me);
  return tid;
end $$;

create or replace function public.join_team(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); tid uuid; tries int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select count(*) into tries from public.join_attempts where user_id = me and at > now() - interval '1 hour';
  if tries >= 10 then raise exception 'Too many tries. Wait an hour, or ask your captain for the invite link.'; end if;
  insert into public.join_attempts (user_id) values (me);
  delete from public.join_attempts where at < now() - interval '1 day';
  select id into tid from public.teams where join_code = upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  if tid is null then raise exception 'No team has that code'; end if;
  insert into public.team_members (team_id, user_id, role) values (tid, me, 'player') on conflict do nothing;
  return tid;
end $$;

create or replace function public.reset_join_code(p_team uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_captain(p_team::text) then raise exception 'Only captains can do that'; end if;
  c := public.new_join_code();
  update public.teams set join_code = c where id = p_team;
  return c;
end $$;

-- "This is me": link your account to a roster spot so you can answer RSVPs for it
create or replace function public.claim_player(p_team uuid, p_player text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); cur text;
begin
  if not public.is_member(p_team::text) then raise exception 'Join the team first'; end if;
  select data->>'uid' into cur from public.docs where scope = p_team::text and col = 'players' and id = p_player;
  if not found then raise exception 'No such player'; end if;
  if cur is not null and cur <> me::text then raise exception 'Someone else already picked that name. Ask your captain.'; end if;
  perform set_config('dugout.claiming', 'on', true);
  update public.docs set data = data - 'uid' where scope = p_team::text and col = 'players' and data->>'uid' = me::text and id <> p_player;
  update public.docs set data = data || jsonb_build_object('uid', me::text) where scope = p_team::text and col = 'players' and id = p_player;
  perform set_config('dugout.claiming', '', true);
end $$;

-- undo it (yourself), or a captain clearing a mistaken claim
create or replace function public.unclaim_player(p_team uuid, p_player text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not public.is_member(p_team::text) then raise exception 'Not on this team'; end if;
  perform set_config('dugout.claiming', 'on', true);
  update public.docs set data = data - 'uid' where scope = p_team::text and col = 'players' and id = p_player
    and (data->>'uid' = me::text or public.is_captain(p_team::text));
  perform set_config('dugout.claiming', '', true);
end $$;

-- a new private calendar link (the old one stops working)
create or replace function public.reset_cal_token() returns text
language plpgsql security definer set search_path = '' as $$
declare t text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  update public.accounts set cal_token = t, updated_at = now() where user_id = (select auth.uid());
  return t;
end $$;

-- merge a few fields into a doc. Runs as the caller, so all the policies and checks above still apply.
create or replace function public.doc_update(p_scope text, p_col text, p_id text, patch jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(patch) <> 'object' then raise exception 'Bad change'; end if;
  update public.docs set data = data || patch where scope = p_scope and col = p_col and id = p_id;
  if not found then raise exception 'Not found or not allowed' using errcode = '42501'; end if;
end $$;

-- delete your account and your personal information (Canada's PIPEDA, and good manners)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); r record;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.accounts where user_id = me and captain_status in ('active', 'trialing', 'past_due')) then
    raise exception 'Cancel your captain plan first (Team menu, Manage plan), then delete your account.';
  end if;
  -- hand captaincy to the longest-standing member where you're the only captain
  for r in select m.team_id from public.team_members m where m.user_id = me and m.role = 'captain'
           and not exists (select 1 from public.team_members o where o.team_id = m.team_id and o.role = 'captain' and o.user_id <> me) loop
    update public.team_members set role = 'captain'
      where (team_id, user_id) = (select team_id, user_id from public.team_members where team_id = r.team_id and user_id <> me order by joined_at limit 1);
  end loop;
  delete from public.docs where scope = 'global' and col = 'messages' and data->>'thread' in
    (select id from public.docs where scope = 'global' and col = 'threads' and (data->>'buyer' = me::text or data->>'seller' = me::text));
  delete from public.docs where scope = 'global' and col = 'threads' and (data->>'buyer' = me::text or data->>'seller' = me::text);
  delete from public.docs where owner = me and (scope = 'global' or col = 'posts');
  delete from public.docs where scope = 'global' and col in ('agents', 'contacts') and id = me::text;
  delete from public.team_members where user_id = me;   -- triggers free roster spots and remove now-empty teams
  delete from auth.users where id = me;                  -- removes the sign-in and the profile
end $$;

-- "online now" for the sub list: the app checks in about once a minute while it's open.
-- Only paid captains can ask who's online, only for people on the sub list, and never for subs who switched it off.
alter table public.accounts add column if not exists last_seen timestamptz;
create or replace function public.i_am_here() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return; end if;
  update public.accounts set last_seen = now()
    where user_id = (select auth.uid()) and (last_seen is null or last_seen < now() - interval '45 seconds');
end $$;
create or replace function public.online_subs() returns setof text
language sql stable security definer set search_path = '' as $$
  select a.id from public.docs a join public.accounts ac on ac.user_id::text = a.id
  where public.is_paid_captain() and a.scope = 'global' and a.col = 'agents'
    and coalesce(a.data->>'hideOnline', 'false') <> 'true' and ac.last_seen > now() - interval '3 minutes';
$$;

-- nobody signed out can call any of these; signed-in users can call only the app's actions
revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_team(text), public.join_team(text), public.reset_join_code(uuid),
  public.claim_player(uuid, text), public.unclaim_player(uuid, text), public.doc_update(text, text, text, jsonb),
  public.delete_my_account(), public.mark_thread_seen(text), public.reset_cal_token(), public.i_am_here(), public.online_subs() to authenticated;
grant execute on function public.is_paid_captain() to authenticated;
grant execute on function public.is_member(text), public.is_captain(text), public.is_any_captain(), public.shares_team(uuid),
  public.contact_unlocked(text), public.owns_player(text, text), public.in_thread(text) to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- listing photos: anyone can view them (they're on public listings); people can only add or remove files in their own folder.
-- Files are capped at 2 MB, images only, and 60 per person.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function public.my_photo_count() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects where bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text;
$$;
revoke execute on function public.my_photo_count() from public, anon;
grant execute on function public.my_photo_count() to authenticated;

drop policy if exists "dugout photos: see own" on storage.objects;
drop policy if exists "dugout photos: upload own" on storage.objects;
drop policy if exists "dugout photos: delete own" on storage.objects;
create policy "dugout photos: see own" on storage.objects for select to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dugout photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}/[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$'
              and public.my_photo_count() < 60);
create policy "dugout photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- live updates
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
