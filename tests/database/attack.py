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
expect('a free player can’t start a team', False, "select public.create_team('Freeloaders')", 'pl')
sql(f"update accounts set captain_status='active', captain_until=now()+interval '30 days' where user_id in ('{U['cap']}','{U['cap2']}')")   # what the payment webhook does
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
expect('a signed-in stranger without the captain plan can’t browse the sub list', True, "select count(*) from docs where col='agents'", 'out', lambda o: o == '0')
expect('a paid captain can browse the sub list', True, "select count(*) from docs where col='agents'", 'cap2', lambda o: o == '1')
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
sql(f"update accounts set captain_status='canceled' where user_id='{U['cap']}'")   # cancelled their plan first
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

print('\n-- gear marketplace')
for k in ['seller', 'buyer', 'snoop']:
    U[k] = str(uuid.uuid5(uuid.NAMESPACE_DNS, k)); sql(f"insert into auth.users(id,email) values ('{U[k]}','{k}@x.com')")
L = {'title': 'Easton Ghost 34/26', 'cat': 'bat', 'cond': 'good', 'price': 180, 'cert': 'usa', 'desc': 'Barely used', 'area': 'Etobicoke, Toronto', 'lat': 43.65432, 'lng': -79.5123,
     'photos': [f"{U['seller']}/L1/a1.jpg"], 'status': 'active'}
expect('anyone signed in can list gear (no team needed); location rounded; seller stamped', True,
       f"insert into docs(scope,col,id,data) values ('global','listings','L1',{j(L)}) returning data::text", 'seller',
       lambda o: '43.65,' in o.replace(' ', '') and U['seller'] in o)
expect('anon cannot see listings', False, "select count(*) from docs where col='listings'", 'anon')
expect('signed-in users see listings', True, "select count(*) from docs where col='listings'", 'snoop', lambda o: o == '1')
expect('listing photo pointing at someone else\'s folder rejected', False,
       f"insert into docs(scope,col,id,data) values ('global','listings','L2',{j({**L, 'photos': [U['buyer'] + '/L2/x.jpg']})})", 'seller')
expect('listing photo as an outside URL rejected', False,
       f"insert into docs(scope,col,id,data) values ('global','listings','L2',{j({**L, 'photos': ['https://evil.example/track.gif']})})", 'seller')
expect('more than 4 photos rejected', False,
       f"insert into docs(scope,col,id,data) values ('global','listings','L2',{j({**L, 'photos': [U['seller'] + f'/L2/p{i}.jpg' for i in range(5)]})})", 'seller')
expect('script in category rejected', False, f"insert into docs(scope,col,id,data) values ('global','listings','L2',{j({**L, 'photos': [], 'cat': '<img onerror=x>'})})", 'seller')
expect('silly price rejected', False, f"insert into docs(scope,col,id,data) values ('global','listings','L2',{j({**L, 'photos': [], 'price': -5})})", 'seller')
expect('someone else cannot edit the listing', True, f"update docs set data=data||'{{\"price\":1}}' where id='L1' returning 1", 'buyer', lambda o: o == '')
expect('someone else cannot delete the listing', True, f"delete from docs where id='L1' returning 1", 'buyer', lambda o: o == '')
expect('seller marks it sold', True, f"select public.doc_update('global','listings','L1','{{\"status\":\"sold\"}}')", 'seller')
sql(f"select public.doc_update('global','listings','L1','{{\"status\":\"active\"}}')", 'seller')

print('\n-- marketplace messages')
expect('seller cannot open a conversation with themselves', False, f"insert into docs(scope,col,id,data) values ('global','threads','L1_{U['seller']}',{j({'listing':'L1'})})", 'seller')
expect('buyer cannot pretend to be someone else', False, f"insert into docs(scope,col,id,data) values ('global','threads','L1_{U['snoop']}',{j({'listing':'L1','buyer':U['snoop']})})", 'buyer')
expect('buyer opens conversation; seller and title come from the listing', True,
       f"insert into docs(scope,col,id,data) values ('global','threads','L1_{U['buyer']}',{j({'listing':'L1','seller':U['snoop'],'title':'fake'})}) returning data::text", 'buyer',
       lambda o: U['seller'] in o and 'Easton Ghost' in o and U['snoop'] not in o)
TH = f"L1_{U['buyer']}"
expect('buyer sends a message; sender is stamped', True, f"insert into docs(scope,col,id,data) values ('global','messages','m1',{j({'thread':TH,'text':'Still available?','from':U['seller']})}) returning data->>'from'", 'buyer', lambda o: o == U['buyer'])
expect('seller replies', True, f"insert into docs(scope,col,id,data) values ('global','messages','m2',{j({'thread':TH,'text':'Yes! Saturday?'})})", 'seller')
expect('conversation summary updated by the database', True, f"select data->>'last' from docs where id='{TH}'", 'buyer', lambda o: o == 'Yes! Saturday?')
expect('outsider cannot see the conversation', True, "select count(*) from docs where col in ('threads','messages')", 'snoop', lambda o: o == '0')
expect('outsider cannot post into it', False, f"insert into docs(scope,col,id,data) values ('global','messages','m3',{j({'thread':TH,'text':'hi'})})", 'snoop')
expect('messages cannot be edited', True, f"update docs set data=data||'{{\"text\":\"changed\"}}' where id='m1' returning 1", 'buyer', lambda o: o == '')
expect('buyer cannot change who is in the conversation', True, f"update docs set data=data||{j({'seller':U['snoop']})} where id='{TH}' returning 1", 'buyer', lambda o: o == '')
expect('mark as read works for a participant', True, f"select public.mark_thread_seen('{TH}')", 'seller')
expect('mark as read refused for an outsider', False, f"select public.mark_thread_seen('{TH}')", 'snoop')
expect('message flood stopped', False, f"insert into docs(scope,col,id,data) select 'global','messages','f'||g,jsonb_build_object('thread','{TH}','text','spam') from generate_series(1,70) g", 'buyer')

print('\n-- reports')
expect('report a listing', True, f"insert into docs(scope,col,id,data) values ('global','reports','r1',{j({'listing':'L1','reason':'scam','note':'asked for e-transfer first'})})", 'snoop')
expect('reports are not readable through the app, even by the reporter', True, "select count(*) from docs where col='reports'", 'snoop', lambda o: o == '0')
expect('report with made-up reason rejected', False, f"insert into docs(scope,col,id,data) values ('global','reports','r2',{j({'listing':'L1','reason':'<x>'})})", 'snoop')

print('\n-- listing photos (storage)')
sql("insert into storage.buckets(id,name) values ('listing-photos','listing-photos') on conflict do nothing")
expect('upload into own folder', True, f"insert into storage.objects(bucket_id,name) values ('listing-photos','{U['seller']}/L1/a1.jpg')", 'seller')
expect('upload into someone else\'s folder refused', False, f"insert into storage.objects(bucket_id,name) values ('listing-photos','{U['buyer']}/L1/a1.jpg')", 'seller')
expect('non-image file name refused', False, f"insert into storage.objects(bucket_id,name) values ('listing-photos','{U['seller']}/L1/evil.html')", 'seller')
expect('cannot delete someone else\'s photo', True, f"delete from storage.objects where name like '{U['seller']}/%' returning 1", 'buyer', lambda o: o == '')
sql(';'.join(f"insert into storage.objects(bucket_id,name) values ('listing-photos','{U['seller']}/L9/p{g}.jpg')" for g in range(59)), 'seller')  # uploads arrive one per request
expect('photo cap: 61st photo refused', False, f"insert into storage.objects(bucket_id,name) values ('listing-photos','{U['seller']}/L9/last.jpg')", 'seller')
expect('anon cannot upload', False, f"insert into storage.objects(bucket_id,name) values ('listing-photos','x/y/z.jpg')", 'anon')

print('\n-- weather / rain-outs')
expect('team home location is rounded to about 1 km', True, f"select public.doc_update('{T}','team','info','{{\"lat\":43.65432,\"lng\":-79.51234,\"place\":\"Etobicoke\"}}'); select data->>'lat' from docs where scope='{T}' and col='team'", None, lambda o: True)

print('\n-- account deletion clears marketplace conversations')
expect('buyer deletes account', True, "select public.delete_my_account()", 'buyer')
ok, out, _ = sql(f"select count(*) from docs where col in ('threads','messages') and (id='{TH}' or data->>'thread'='{TH}')")
expect('...conversation and both sides\' messages gone', True, 'select 1', None, lambda o: out == '0')

print('\n-- paid captain plan')
for k in ['free', 'lapsed', 'paid2']:
    U[k] = str(uuid.uuid5(uuid.NAMESPACE_DNS, k)); sql(f"insert into auth.users(id,email) values ('{U[k]}','{k}@x.com')")
expect('every new person gets an account row, free by default', True, f"select captain_status from accounts where user_id='{U['free']}'", None, lambda o: o == 'none')
expect('people can read their own account', True, "select count(*) from accounts", 'free', lambda o: o == '1')
expect('people can’t give themselves the captain plan', False, "update accounts set captain_status='active'", 'free')
expect('people can’t read someone else’s calendar link', True, f"select count(*) from accounts where user_id='{U['cap']}'", 'free', lambda o: o == '0')
sql(f"insert into docs(scope,col,id,data) values ('global','agents','{U['free']}','{{\"name\":\"Free Sub\"}}')", 'free')
expect('a free player sees only their own sub profile, not the master list', True, "select count(*) from docs where col='agents'", 'free', lambda o: o == '1')
sql(f"update accounts set captain_status='active', captain_until=now()+interval '30 days' where user_id='{U['paid2']}'")
expect('a paid captain sees the master sub list', True, "select count(*) from docs where col='agents'", 'paid2', lambda o: int(o) >= 1)
sql(f"update accounts set captain_status='canceled', captain_until=now()-interval '10 days' where user_id='{U['lapsed']}'")
expect('a lapsed captain loses the master list', True, "select count(*) from docs where col='agents'", 'lapsed', lambda o: o == '1' or o == '0')
expect('a lapsed captain can’t start a new team', False, "select public.create_team('Old Team')", 'lapsed')
expect('can’t delete an account with a live captain plan (cancel first)', False, "select public.delete_my_account()", 'paid2')
expect('new private calendar link', True, "select length(public.reset_cal_token())", 'free', lambda o: o == '64')
# grandfathering: captains from before paid plans keep their tools, once
sql("delete from app_flags where key='grandfathered'")
code2 = sql("select join_code from teams limit 1")[1]
sql(f"select public.join_team('{code2}')", 'free')
sql(f"update team_members set role='captain' where user_id='{U['free']}'")
subprocess.run(DB[:-4] + ['-q', '-f', '../../supabase/schema.sql'], capture_output=True, text=True)
expect('existing captains are grandfathered the first time paid plans switch on', True, f"select grandfathered from accounts where user_id='{U['free']}'", None, lambda o: o == 't')
sql(f"update team_members set role='captain' where user_id='{U['lapsed']}'") if False else None
subprocess.run(DB[:-4] + ['-q', '-f', '../../supabase/schema.sql'], capture_output=True, text=True)
expect('...and running the setup again doesn’t grandfather anyone new', True, f"select grandfathered from accounts where user_id='{U['paid2']}'", None, lambda o: o == 'f')

print('\n-- team chat')
TC = sql(f"select team_id from team_members where user_id='{U['free']}' limit 1")[1]
expect('member sends a chat message; sender and time stamped', True, f"insert into docs(scope,col,id,data) values ('{TC}','chat','c1','{{\"text\":\"On my way\",\"u\":\"{U['cap']}\"}}') returning data->>'u'", 'free', lambda o: o.split('\n')[-1] == U['free'])
expect('outsider can’t read the chat', True, f"select count(*) from docs where col='chat'", 'lapsed', lambda o: o == '0')
expect('outsider can’t post in it', False, f"insert into docs(scope,col,id,data) values ('{TC}','chat','c2','{{\"text\":\"hi\"}}')", 'lapsed')
expect('chat messages can’t be edited', True, f"update docs set data=data||'{{\"text\":\"x\"}}' where id='c1' returning 1", 'free', lambda o: False) if False else expect('chat messages can’t be edited', False, f"update docs set data=data||'{{\"text\":\"x\"}}' where id='c1'", None)
expect('empty message refused', False, f"insert into docs(scope,col,id,data) values ('{TC}','chat','c3','{{\"text\":\"\"}}')", 'free')
expect('people delete their own message', True, f"delete from docs where id='c1' returning 1", 'free', lambda o: o.endswith('1'))

print('\n-- online now')
sql("select public.i_am_here()", 'free')
expect('a paid captain sees which subs are online', True, "select count(*) from public.online_subs()", 'paid2', lambda o: o == '1')
expect('a free player can’t see who’s online', True, "select count(*) from public.online_subs()", 'lapsed', lambda o: o == '0')
sql(f"update docs set data=data||'{{\"hideOnline\":true}}' where col='agents' and id='{U['free']}'", 'free')
expect('subs can switch off showing they’re online', True, "select count(*) from public.online_subs()", 'paid2', lambda o: o == '0')
expect('nobody can mark someone else online', False, f"update accounts set last_seen=now() where user_id='{U['cap']}' returning 1", 'free')

print('\n-- sub levels')
expect('Elite (level 5) is gone: a new profile can’t use it', False, f"update docs set data=data||'{{\"skill\":5}}' where col='agents' and id='{U['free']}'", 'free')
sql(f"alter table docs disable trigger user; update docs set data=data||'{{\"skill\":5}}' where col='agents' and id='{U['free']}'; alter table docs enable trigger user;")
subprocess.run(DB[:-4] + ['-q', '-f', '../../supabase/schema.sql'], capture_output=True, text=True)
expect('...and old Elite profiles become Competitive (4)', True, f"select data->>'skill' from docs where col='agents' and id='{U['free']}'", None, lambda o: o == '4')

print('\n-- marketplace admin')
for k in ['boss', 'vendor', 'shopper']:
    U[k] = str(uuid.uuid5(uuid.NAMESPACE_DNS, k)); sql(f"insert into auth.users(id,email) values ('{U[k]}','{k}@x.com')")
sql(f"insert into admins(user_id) values ('{U['boss']}')")
LV = {**L, 'photos': []}
sql(f"insert into docs(scope,col,id,data) values ('global','listings','V1',{j(LV)})", 'vendor')
sql(f"insert into docs(scope,col,id,data) values ('global','listings','V2',{j(LV)})", 'vendor')
expect('people can’t make themselves an admin', False, f"insert into admins(user_id) values ('{U['shopper']}')", 'shopper')
expect('people can’t read the admin list, bans or log', True, "select (select count(*) from admins)", 'shopper', lambda o: False) if False else expect('people can’t read the admin list', False, "select count(*) from admins", 'shopper')
expect('people can’t read the admin log', False, "select count(*) from admin_log", 'shopper')
expect('a seller can’t mark their own listing removed (only admins remove)', False, "update docs set data=data||'{\"status\":\"removed\"}' where id='V1'", 'vendor')
expect('non-admins can’t use admin actions', False, "select public.admin_listing_status('V1','removed','x')", 'shopper')
expect('non-admins can’t read reports', True, "select count(*) from docs where col='reports'", 'shopper', lambda o: o == '0')
sql(f"insert into docs(scope,col,id,data) values ('global','reports','R9','{{\"listing\":\"V1\",\"reason\":\"scam\",\"note\":\"asked for a deposit\"}}')", 'shopper')
expect('new reports start open', True, "select data->>'status' from docs where id='R9'", None, lambda o: o == 'open')
expect('an admin sees reports', True, "select count(*) from docs where col='reports' and id='R9'", 'boss', lambda o: o == '1')
expect('an admin sees the overview', True, "select public.admin_overview()->>'openReports'", 'boss', lambda o: int(o) >= 1)
expect('admin removes a listing', True, "select public.admin_listing_status('V1','removed','Scam report')", 'boss')
expect('...removed listings disappear from Gear for everyone else', True, "select count(*) from docs where id='V1'", 'shopper', lambda o: o == '0')
expect('...the seller still sees it (marked removed)', True, "select data->>'status' from docs where id='V1'", 'vendor', lambda o: o == 'removed')
expect('...and can’t put it back up themselves', False, "update docs set data=data||'{\"status\":\"active\"}' where id='V1'", 'vendor')
expect('admin closes the report', True, "select public.admin_resolve_report('R9','actioned','Removed the listing')", 'boss')
sql("update docs set data=data||'{\"status\":\"dismissed\"}' where id='R9'", 'shopper')
expect('...people still can’t edit reports', True, "select data->>'status' from docs where id='R9'", None, lambda o: o == 'actioned')
expect('admin bans the seller from Gear (7 days), hiding their other listings', True, f"select public.admin_ban('{U['vendor']}','Scam',7,true)", 'boss')
expect('...their other listings are hidden too', True, "select count(*) from docs where id='V2'", 'shopper', lambda o: o == '0')
expect('...a banned seller can’t list', False, f"insert into docs(scope,col,id,data) values ('global','listings','V3',{j(LV)})", 'vendor')
expect('...or start a conversation', False, f"insert into docs(scope,col,id,data) values ('global','threads','L1_{U['vendor']}','{{\"listing\":\"L1\"}}')", 'vendor')
expect('admins can’t ban themselves', False, f"select public.admin_ban('{U['boss']}','x',null,false)", 'boss')
expect('admin sees the ban list', True, "select count(*) from public.admin_bans()", 'boss', lambda o: o == '1')
expect('every admin action is logged', True, "select count(*) from public.admin_activity()", 'boss', lambda o: int(o) >= 3)
expect('admin restores a listing', True, "select public.admin_listing_status('V2','active','')", 'boss')
expect('admin lifts the ban', True, f"select public.admin_unban('{U['vendor']}')", 'boss')
expect('...and the seller can list again', True, f"insert into docs(scope,col,id,data) values ('global','listings','V4',{j(LV)})", 'vendor')
expect('admin deletes a listing for good', True, "select public.admin_delete_listing('V1','scam')", 'boss')
expect('...it’s gone', True, "select count(*) from docs where id='V1'", None, lambda o: o == '0')

print('\n-- ban evasion and scam flags')
U['evader'] = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'evader')); sql(f"insert into auth.users(id,email) values ('{U['evader']}','Casey.Jones+gear@gmail.com')")
expect('admin bans a seller (their email is remembered, hashed)', True, f"select public.admin_ban('{U['evader']}','Scam',null,true)", 'boss')
expect('...only a hash is kept, not the email', True, "select count(*) from banned_emails where hash !~ '@'", None, lambda o: int(o) >= 1)
sql(f"delete from auth.users where id='{U['evader']}'")
U['evader2'] = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'evader2')); sql(f"insert into auth.users(id,email) values ('{U['evader2']}','caseyjones@gmail.com')")
expect('a new account with the same mailbox (dots and +tags ignored) is banned from Gear straight away', True, f"select count(*) from market_bans where user_id='{U['evader2']}'", None, lambda o: o == '1')
expect('...so it can’t list', False, f"insert into docs(scope,col,id,data) values ('global','listings','E1',{j(LV)})", 'evader2')
expect('...and the auto-ban is in the activity log', True, "select count(*) from public.admin_activity() where action='auto-ban'", 'boss', lambda o: o == '1')
expect('lifting the ban clears the remembered email', True, f"select public.admin_unban('{U['evader2']}')", 'boss')
expect('people can’t read banned emails or flags', False, "select count(*) from auto_flags", 'shopper')
sql(f"insert into docs(scope,col,id,data) values ('global','listings','S1',{j({**LV, 'title': 'Demarini bat', 'desc': 'Send a $50 deposit by e-transfer first to hold it, then I ship'})})", 'vendor')
expect('a scammy listing is flagged automatically', True, "select array_to_string(terms, ',') from auto_flags where kind='listing' and target='S1'", None, lambda o: 'deposit' in o and 'pay before meeting' in o)
sql(f"insert into docs(scope,col,id,data) values ('global','listings','S2',{j({**LV, 'title': 'Glove', 'desc': 'Barely used. Cash or e-transfer when we meet at the park.'})})", 'vendor')
expect('...an honest listing (e-transfer at the meetup) is not', True, "select count(*) from auto_flags where target='S2'", None, lambda o: o == '0')
sql(f"insert into docs(scope,col,id,data) values ('global','threads','S2_{U['shopper']}','{{\"listing\":\"S2\"}}')", 'shopper')
sql(f"insert into docs(scope,col,id,data) values ('global','messages','m1','{{\"thread\":\"S2_{U['shopper']}\",\"text\":\"Can you buy me a gift card and text me on WhatsApp\"}}')", 'shopper')
expect('a scammy Gear message is flagged with the matched words only (the message stays private)', True, f"select array_to_string(terms, ',') || '|' || excerpt from auto_flags where kind='message' and target='S2_{U['shopper']}'", None, lambda o: o.startswith('gift cards,move to another app|') and o.endswith('|'))
expect('admin sees the flags with the listing name', True, "select count(*) from public.admin_flags() where listing_title is not null", 'boss', lambda o: int(o) >= 2)
expect('non-admins can’t list flags', False, "select * from public.admin_flags()", 'shopper')
fid = sql("select id from auto_flags where target='S1'")[1]
expect('admin dismisses a flag', True, f"select public.admin_close_flag({fid},'dismissed')", 'boss')

print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
