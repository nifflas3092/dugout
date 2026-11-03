# Tries to break Dugout's database rules the way a malicious user with the public key could.
# Each line is one attack (or one thing that must keep working). Run after every change to supabase/schema.sql.
import subprocess, json, sys, uuid
import os
# Point these at a throwaway local Postgres (never your real Supabase project): see tests/README.md
DB = ['psql', '-h', os.environ.get('PGHOST', '/tmp'), '-p', os.environ.get('PGPORT', '5432'), '-U', os.environ.get('PGUSER', 'postgres'), '-d', os.environ.get('PGDATABASE', 'dugout_test'), '-At', '-v', 'ON_ERROR_STOP=1', '-q']
U = {k: str(uuid.uuid5(uuid.NAMESPACE_DNS, k)) for k in ['cap', 'cap2', 'pl', 'pl2', 'out', 'sub']}
results = []

def sql(q, who=None):
    pre = 'reset role;' if who is None else ("set role anon;" if who == 'anon' else f"set role authenticated; select set_config('request.jwt.claim.sub','{U[who]}',false);")
    p = subprocess.run(DB + ['-c', pre + q], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().split('\n') if l]
    if who not in (None, 'anon') and out and out[0] == U[who]: out = out[1:]
    return p.returncode == 0, '\n'.join(out), p.stderr.strip().split('\n')[0] if p.stderr else ''

def expect(name, ok_wanted, q, who, check=None):
    ok, out, err = sql(q, who)
    passed = ok == ok_wanted and (check is None or check(out))
    results.append(passed)
    print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else f'   -> ok={ok} out={out[:200]} err={err[:200]}'))
    return out

j = lambda o: "'" + json.dumps(o).replace("'", "''") + "'::jsonb"
# --- set up accounts
for k in U: sql(f"insert into auth.users(id,email,raw_user_meta_data) values ('{U[k]}','{k}@x.com','{{\"name\":\"{k.upper()}\"}}')")
T = expect('captain creates a team', True, "select public.create_team('Riverside Rally')", 'cap').split('\n')[-1]
T2 = expect('another captain creates a team', True, "select public.create_team('Base Invaders')", 'cap2').split('\n')[-1]
code = sql(f"select join_code from teams where id='{T}'")[1]
expect('join code is 8 unambiguous characters', True, 'select 1', None, lambda o: len(code) == 8 and not set(code) & set('01OIL'))
expect('player joins with the code', True, f"select public.join_team('{code.lower()}')", 'pl')
expect('second player joins with dashes/spaces in code', True, f"select public.join_team('{code[:4]}-{code[4:]} ')", 'pl2')
expect('captain adds roster spots', True, f"insert into docs(scope,col,id,data) values ('{T}','players','p1',{j({'name':'Jordan'})}),('{T}','players','p2',{j({'name':'Pat'})}),('{T}','games','g1',{j({'opp':'X','date':'2026-11-10'})})", 'cap')

print('\n-- signed-out visitors')
expect('anon cannot read docs', False, 'select count(*) from docs', 'anon')
expect('anon cannot read teams', False, 'select count(*) from teams', 'anon')
expect('anon cannot create a team', False, "select public.create_team('x')", 'anon')
expect('anon cannot read profiles', False, 'select count(*) from profiles', 'anon')

print('\n-- team privacy')
expect('outsider sees no team docs', True, f"select count(*) from docs where scope='{T}'", 'out', lambda o: o == '0')
expect('outsider sees no teams or members', True, 'select (select count(*) from teams)+(select count(*) from team_members)', 'out', lambda o: o == '0')
expect('other captain cannot write into our team', False, f"insert into docs(scope,col,id,data) values ('{T}','players','evil',{j({'name':'x'})})", 'cap2')
expect('outsider cannot read join codes', True, f"select count(*) from teams where id='{T}'", 'out', lambda o: o == '0')
expect('player cannot read join_attempts', False, 'select count(*) from join_attempts', 'pl')
expect('profiles: player sees teammates only', True, 'select count(*) from profiles', 'pl', lambda o: o == '3')

print('\n-- players vs captain powers')
expect('player cannot edit roster', True, f"update docs set data=data||'{{\"name\":\"hax\"}}' where scope='{T}' and col='players' and id='p1' returning 1", 'pl', lambda o: o == '')
ok, out, _ = sql(f"select data->>'name' from docs where scope='{T}' and id='p1'")
expect('roster unchanged after attempt', True, 'select 1', None, lambda o: out == 'Jordan')
expect('player cannot add a game', False, f"insert into docs(scope,col,id,data) values ('{T}','games','g9',{j({'opp':'x'})})", 'pl')
expect('player cannot use doc_update on a game', False, f"select public.doc_update('{T}','games','g1',{j({'opp':'hax'})})", 'pl')
expect('player cannot rename team', True, f"update teams set name='hax' where id='{T}' returning 1", 'pl', lambda o: o == '')
expect('player cannot make self captain', True, f"update team_members set role='captain' where user_id='{U['pl']}' returning 1", 'pl', lambda o: o == '')
expect('captain cannot change a member user_id (column locked)', False, f"update team_members set user_id='{U['out']}' where user_id='{U['pl']}'", 'cap')
expect('captain cannot change join_code directly', False, f"update teams set join_code='AAAAAAAA' where id='{T}'", 'cap')
expect('captain can reset join code', True, f"select public.reset_join_code('{T}')", 'cap', lambda o: len(o.split('\n')[-1]) == 8)
expect('player cannot reset join code', False, f"select public.reset_join_code('{T}')", 'pl')

print('\n-- RSVPs belong to the person')
expect('player cannot RSVP before claiming a spot', False, f"insert into docs(scope,col,id,data) values ('{T}','rsvp','g1_p1',{j({'g':'g1','p':'p1','s':'in'})})", 'pl')
expect('player claims spot p1', True, f"select public.claim_player('{T}','p1')", 'pl')
expect('second player cannot take a claimed spot', False, f"select public.claim_player('{T}','p1')", 'pl2')
expect('player RSVPs for own spot', True, f"insert into docs(scope,col,id,data) values ('{T}','rsvp','g1_p1',{j({'g':'g1','p':'p1','s':'in'})})", 'pl')
expect('player cannot RSVP for someone else', False, f"insert into docs(scope,col,id,data) values ('{T}','rsvp','g1_p2',{j({'g':'g1','p':'p2','s':'out'})})", 'pl')
expect('player cannot overwrite own RSVP to point at another spot', False, f"update docs set data={j({'g':'g1','p':'p2','s':'out'})} where scope='{T}' and id='g1_p1'", 'pl')
expect('RSVP id must match game and player', False, f"insert into docs(scope,col,id,data) values ('{T}','rsvp','zzz',{j({'g':'g1','p':'p1','s':'in'})})", 'pl')
expect('RSVP value must be in/maybe/out', False, f"update docs set data=data||'{{\"s\":\"<b>\"}}' where scope='{T}' and id='g1_p1'", 'pl')
expect('player2 cannot change player1 RSVP', True, f"update docs set data=data||'{{\"s\":\"out\"}}' where scope='{T}' and id='g1_p1' returning 1", 'pl2', lambda o: o == '')
expect('player cannot forge a claim by writing uid', True, f"update docs set data=data||{j({'uid':U['pl2']})} where scope='{T}' and id='p2' returning 1", 'pl2', lambda o: o == '')
expect('captain saving a player keeps the claim', True, f"update docs set data={j({'name':'Jordan B','uid':U['cap']})} where scope='{T}' and id='p1' returning data->>'uid'", 'cap', lambda o: o.split('\n')[-1] == U['pl'])
expect('captain can RSVP for anyone', True, f"insert into docs(scope,col,id,data) values ('{T}','rsvp','g1_p2',{j({'g':'g1','p':'p2','s':'maybe'})})", 'cap')

print('\n-- board posts')
expect('player posts', True, f"insert into docs(scope,col,id,data) values ('{T}','posts','m1',{j({'text':'hi','u':U['cap']})}) returning data->>'u'", 'pl', lambda o: o.split('\n')[-1] == U['pl'])
expect('post author cannot be spoofed via owner column', True, f"insert into docs(scope,col,id,data,owner) values ('{T}','posts','m2',{j({'text':'yo'})},'{U['cap']}') returning owner", 'pl2', lambda o: o.split('\n')[-1] == U['pl2'])
expect('player cannot delete someone else\'s post', True, f"delete from docs where scope='{T}' and id='m1' returning 1", 'pl2', lambda o: o == '')
expect('player cannot edit own post (captain-only pin)', True, f"update docs set data=data||'{{\"pin\":true}}' where scope='{T}' and id='m1' returning 1", 'pl', lambda o: o == '')
expect('player deletes own post', True, f"delete from docs where scope='{T}' and id='m2' returning 1", 'pl2', lambda o: o.endswith('1'))
expect('captain pins a post', True, f"select public.doc_update('{T}','posts','m1','{{\"pin\":true}}')", 'cap')
expect('empty or huge posts rejected', False, f"insert into docs(scope,col,id,data) values ('{T}','posts','m3',{j({'text':'x'*601})})", 'pl')

print('\n-- malicious data')
expect('script-y document id rejected', False, f"insert into docs(scope,col,id,data) values ('{T}','games','\"><img src=x onerror=alert(1)>',{j({'opp':'x'})})", 'cap')
expect('unknown collection rejected', False, f"insert into docs(scope,col,id,data) values ('{T}','secrets','a','{{}}')", 'cap')
expect('global collection in team scope rejected', False, f"insert into docs(scope,col,id,data) values ('{T}','agents','a','{{}}')", 'cap')
expect('oversized document rejected', False, f"insert into docs(scope,col,id,data) values ('{T}','games','big',jsonb_build_object('x',repeat(md5(random()::text),3000)))", 'cap')
expect('moving a doc to another team blocked', False, f"update docs set scope='{T2}' where scope='{T}' and id='g1'", 'cap')

print('\n-- sub list and contact privacy')
expect('sub creates profile; contact in profile is stripped; location rounded', True,
       f"insert into docs(scope,col,id,data) values ('global','agents','{U['sub']}',{j({'name':'Sam','contact':'416-555-0100','lat':43.65432,'lng':-79.51234})}) returning data::text", 'sub',
       lambda o: 'contact' not in o and '43.65' in o and '43.654' not in o)
expect('sub profile with script in a field is rejected', False, f"update docs set data=data||{j({'bats':'<img src=x onerror=alert(1)>'})} where col='agents'", 'sub')
expect('sub profile with non-list days rejected', False, f"update docs set data=data||{j({'days':'Mon<script>'})} where col='agents'", 'sub')
expect('sub profile with a full realistic payload accepted', True, f"update docs set data={j({'name':'Sam','gender':'w','skill':3,'bats':'R','throws':'L','pos':['SS','2B'],'str':['Soft hands'],'weak':['Hitting'],'about':'hi','days':['Mon','Wed'],'times':['evening'],'radius':15,'active':True,'area':'Etobicoke, Toronto','lat':43.65,'lng':-79.51,'updated':1})} where col='agents' returning 1", 'sub', lambda o: o.endswith('1'))
expect('sub saves contact separately', True, f"insert into docs(scope,col,id,data) values ('global','contacts','{U['sub']}',{j({'contact':'416-555-0100','extra':'x'})}) returning data::text", 'sub', lambda o: 'extra' not in o)
expect('cannot create a sub profile for someone else', False, f"insert into docs(scope,col,id,data) values ('global','agents','{U['out']}',{j({'name':'x'})})", 'sub')
expect('any signed-in user sees the sub list', True, "select count(*) from docs where col='agents'", 'out', lambda o: o == '1')
expect('outsider cannot see contacts', True, "select count(*) from docs where col='contacts'", 'out', lambda o: o == '0')
expect('captain cannot see contact before sub says yes', True, "select count(*) from docs where col='contacts'", 'cap', lambda o: o == '0')
expect('non-captain cannot send requests', False, f"insert into docs(scope,col,id,data) values ('global','invites','i0',{j({'agent':U['sub'],'teamId':T})})", 'pl')
expect('captain cannot send a request as a team they do not captain', False, f"insert into docs(scope,col,id,data) values ('global','invites','i0',{j({'agent':U['sub'],'teamId':T2})})", 'cap')
expect('captain sends request; team name/status/sender forced', True,
       f"insert into docs(scope,col,id,data) values ('global','invites','i1',{j({'agent':U['sub'],'teamId':T,'team':'Fake Team','status':'accepted','by':U['cap2'],'note':'need an OF'})}) returning data::text", 'cap',
       lambda o: '"Riverside Rally"' in o and '"pending"' in o and U['cap2'] not in o)
expect('captain cannot mark own request accepted', True, f"select public.doc_update('global','invites','i1','{{\"status\":\"accepted\"}}'); select data->>'status' from docs where id='i1'", 'cap', lambda o: o.split('\n')[-1] == 'pending')
expect('other captain cannot see the request', True, "select count(*) from docs where col='invites'", 'cap2', lambda o: o == '0')
expect('sub sees the request', True, "select count(*) from docs where col='invites'", 'sub', lambda o: o == '1')
expect('sub cannot rewrite the request', True, f"select public.doc_update('global','invites','i1',{j({'status':'accepted','team':'Hax','agent':U['out']})}); select 1", 'sub')
ok, out, _ = sql(f"select data->>'team' || '|' || (data->>'agent') || '|' || (data->>'status') from docs where id='i1'")
expect('...only the answer changed', True, 'select 1', None, lambda o: out == f"Riverside Rally|{U['sub']}|accepted")
expect('captain now sees the contact', True, "select data->>'contact' from docs where col='contacts'", 'cap', lambda o: o == '416-555-0100')
expect('other captain still cannot', True, "select count(*) from docs where col='contacts'", 'cap2', lambda o: o == '0')
expect('sub answer must be accepted/declined', False, f"select public.doc_update('global','invites','i1','{{\"status\":\"<x>\"}}')", 'sub')
expect('non-captain cannot add diamonds', False, f"insert into docs(scope,col,id,data) values ('global','diamonds','d1',{j({'name':'Pits','lat':1,'lng':2})})", 'pl')
expect('captain adds diamond', True, f"insert into docs(scope,col,id,data) values ('global','diamonds','d1',{j({'name':'Pits','lat':1,'lng':2})})", 'cap')
expect('other captain cannot edit it', True, f"update docs set data=data||'{{\"name\":\"x\"}}' where id='d1' returning 1", 'cap2', lambda o: o == '')

print('\n-- brute force and flooding')
for i in range(8): sql("select public.join_team('ZZZZZZZZ')", 'out')
expect('11th join attempt in an hour is refused, even with the right code', False, f"select public.join_team((select join_code from teams where id='{T}'))", 'out')
expect('flood of 150 docs in a minute is stopped', False, f"insert into docs(scope,col,id,data) select '{T}','ab','f'||g,'{{}}' from generate_series(1,150) g", 'cap')

print('\n-- functions are locked down')
expect('no SECURITY DEFINER function without a fixed search_path', True,
       "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')", None, lambda o: o == '0')
expect('anon cannot execute any public function', True,
       "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')", None, lambda o: o == '0')
expect('every public table has RLS on', True, "select count(*) from pg_tables where schemaname='public' and not rowsecurity", None, lambda o: o == '0')

print('\n-- captains and leaving')
expect('only captain cannot leave while others remain', False, f"delete from team_members where team_id='{T}' and user_id='{U['cap']}'", 'cap')
expect('only captain cannot demote self', False, f"update team_members set role='player' where team_id='{T}' and user_id='{U['cap']}'", 'cap')
expect('player can leave; their roster spot is freed', True, f"delete from team_members where team_id='{T}' and user_id='{U['pl']}'", 'pl')
ok, out, _ = sql(f"select coalesce(data->>'uid','none') from docs where scope='{T}' and id='p1'")
expect('...spot p1 unclaimed', True, 'select 1', None, lambda o: out == 'none')
expect('captain can rename team via settings doc; teams row follows', True, f"select public.doc_update('{T}','team','info','{{\"name\":\"Riverside Rally II\"}}'); select name from teams where id='{T}'", 'cap', lambda o: o.endswith('Riverside Rally II'))

print('\n-- deleting an account')
expect('captain deletes account; captaincy passes on', True, "select public.delete_my_account()", 'cap')
ok, out, _ = sql(f"select role from team_members where team_id='{T}'")
expect('...remaining member is now captain', True, 'select 1', None, lambda o: out == 'captain')
ok, out, _ = sql(f"select (select count(*) from auth.users where id='{U['cap']}') + (select count(*) from profiles where id='{U['cap']}') + (select count(*) from docs where owner='{U['cap']}' and (scope='global' or col='posts'))")
expect('...their login, profile, requests and posts are gone', True, 'select 1', None, lambda o: out == '0')
expect('sub deletes account; profile and contact gone', True, "select public.delete_my_account()", 'sub')
ok, out, _ = sql(f"select count(*) from docs where id='{U['sub']}'")
expect('...nothing left', True, 'select 1', None, lambda o: out == '0')
expect('last member leaving deletes the team and its data', True, f"delete from team_members where team_id='{T2}'", 'cap2')
ok, out, _ = sql(f"select (select count(*) from teams where id='{T2}') + (select count(*) from docs where scope='{T2}')")
expect('...team gone', True, 'select 1', None, lambda o: out == '0')

print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
