# Clicks through Dugout as a captain and a player in a real browser, against an in-browser stand-in for Supabase.
# The stand-in imitates the database rules; the real rules are tested in tests/database.
import asyncio, subprocess, json, sys, re
from playwright.async_api import async_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..','..')); FAKE=open(os.path.join(HERE,'fake-supabase.js')).read(); OUT=os.path.join(HERE,'screenshots')+'/'; os.makedirs(OUT,exist_ok=True)
CFG="export const SUPABASE_URL='https://fake.supabase.co';export const SUPABASE_ANON_KEY='x';export const GEOCODER='nominatim';export const MAPBOX_TOKEN='';"
INDEX=re.sub(r' integrity="[^"]+"','',open(APP+'/index.html').read())  # the test double can't match the real library's hash
srv=subprocess.Popen([sys.executable,'-m','http.server','8766','-d',APP],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
errs=[]; checks=[]
def check(name, cond): checks.append(bool(cond)); print(('PASS ' if cond else 'FAIL ')+name)
async def setup(ctx):
  await ctx.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
  await ctx.route('**/config.js', lambda r: r.fulfill(body=CFG, content_type='application/javascript'))
  await ctx.route(re.compile(r'http://localhost:8766/(index\.html)?(\?.*)?$'), lambda r: r.fulfill(body=INDEX, content_type='text/html'))
  await ctx.route('https://nominatim.openstreetmap.org/**', lambda r: r.fulfill(body=json.dumps([{"lat":"43.65","lon":"-79.51","name":"Etobicoke","address":{"suburb":"Etobicoke","city":"Toronto","state":"Ontario"},"display_name":"Etobicoke, Toronto"}]), content_type='application/json'))
  await ctx.route('https://fonts.**', lambda r: r.abort())
async def page(ctx, user, w=1280, h=860, pending=None):
  p=await ctx.new_page(); await p.set_viewport_size({'width':w,'height':h})
  if user: await p.add_init_script(f"window.__fakeUser={json.dumps(user)}")
  if pending: await p.add_init_script(f"window.__pendingUser={json.dumps(pending)}")
  p.on('pageerror', lambda e: errs.append('pageerror: '+str(e)))
  p.on('console', lambda m: (m.type=='error' and 'ERR_' not in m.text) and errs.append(m.text))
  return p
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); ctx=await b.new_context(); await setup(ctx)
    cap=await page(ctx,None,400,800,pending={'id':'u-cap','email':'cap@x.com','name':'Casey'})
    await cap.goto('http://localhost:8766/'); await cap.wait_for_selector('#signin')
    await cap.fill('#em','cap@x.com'); await cap.fill('#nm','Casey'); await cap.click('#signin .btn'); await cap.wait_for_selector('#codeF:not([hidden])')
    await cap.fill('#cd','999999'); await cap.click('#codeF .btn'); await cap.wait_for_timeout(200)
    check('wrong code rejected with a clear message', 'didn’t work' in await cap.inner_text('#cMsg'))
    await cap.screenshot(path=OUT+'v2_1_code.png')
    await cap.fill('#cd','123456'); await cap.click('#codeF .btn'); await cap.wait_for_selector('#newF')
    check('right code signs in', True)
    await cap.set_viewport_size({'width':1280,'height':860})
    await cap.fill('#tn','Riverside Rally'); await cap.click('#newF .btn'); await cap.wait_for_selector('#app:not([hidden])'); await cap.wait_for_timeout(300)
    await cap.goto('http://localhost:8766/#roster'); await cap.wait_for_selector('#pf')
    for nm,num in [('Casey','7'),('Jordan','12'),('Pat','3')]:
      await cap.fill('#pName',nm); await cap.fill('#pNum',num); await cap.click('#pfSave'); await cap.wait_for_timeout(150)
    await cap.goto('http://localhost:8766/#schedule'); await cap.wait_for_timeout(300)
    await cap.click('#addGame'); await cap.fill('#gOpp','Base Invaders'); await cap.fill('#gDate','2026-11-10'); await cap.fill('#gTime','18:30'); await cap.fill('#gField','Diamond 3')
    await cap.click('#gf button[type=submit]'); await cap.wait_for_timeout(300)
    await cap.click('text=Team menu'); await cap.wait_for_selector('dialog.menu[open]'); code=await cap.inner_text('dialog.menu code')
    check('captain sees New code and Delete account options', await cap.locator('#mNewCode').count()==1 and await cap.locator('#mDel').count()==1)
    await cap.screenshot(path=OUT+'v2_2_menu.png'); await cap.click('#mClose')

    pl=await page(ctx,{'id':'u-pl','email':'pl@x.com','name':'Jordan'},400,800); await pl.goto('http://localhost:8766/?join='+code)
    await pl.wait_for_selector('#app:not([hidden])'); await pl.wait_for_timeout(400)
    await pl.click('[data-open]'); await pl.wait_for_timeout(600)
    check('player sees no RSVP buttons for other people', await pl.locator('[data-rsvp]:visible').count()==0)
    check('player sees This is me buttons', await pl.locator('[data-me]:visible').count()==3)
    await pl.screenshot(path=OUT+'v2_3_player_list.png')
    await pl.locator('.rsvp-row:has-text("Jordan") [data-me]').click(); await pl.wait_for_timeout(500)
    txt=await pl.inner_text('#view'); check('player is linked to Jordan', "You're Jordan" in txt.replace('\n',' ') or 'Jordan' in (await pl.inner_text('.rsvp-row.me')))
    await pl.locator('.rsvp-row.me [data-rsvp][data-v=in]').first.click(); await pl.wait_for_timeout(700)
    check('captain sees the RSVP live', '1 in' in (await cap.inner_text('#view')).lower())
    await pl.screenshot(path=OUT+'v2_4_player_rsvp.png')

    await pl.goto('http://localhost:8766/#board'); await pl.wait_for_selector('#bText'); await pl.fill('#bText','I can bring the bases'); await pl.click('#bf .btn'); await pl.wait_for_timeout(400)
    check('player can delete own post', await pl.locator('[data-delpost]').count()==1)
    await cap.goto('http://localhost:8766/#board'); await cap.wait_for_timeout(400); await cap.fill('#bText','Captain note'); await cap.click('#bf .btn'); await cap.wait_for_timeout(500)
    await pl.wait_for_timeout(300)
    check('player cannot delete captain post (only 1 delete button of 2 posts)', await pl.locator('.post').count()==2 and await pl.locator('[data-delpost]').count()==1)

    await pl.goto('http://localhost:8766/#subs'); await pl.wait_for_timeout(300); await pl.click('[data-mode=me]'); await pl.wait_for_selector('#af')
    await pl.fill('#aName','Jordan'); await pl.fill('#aWhere','Etobicoke'); await pl.fill('#aContact','text 416-555-0100'); await pl.click('#aSave'); await pl.wait_for_timeout(800)
    d=await pl.evaluate("JSON.parse(localStorage.getItem('fake-sb-db')).docs.filter(d=>d.col==='agents'||d.col==='contacts').map(d=>[d.col,JSON.stringify(d.data)])")
    check('contact saved separately, not on the public profile', any(c=='contacts' for c,_ in d) and all('416' not in j for c,j in d if c=='agents'))
    await cap.goto('http://localhost:8766/#subs'); await cap.wait_for_timeout(500); await cap.click('[data-mode=find]'); await cap.wait_for_timeout(300)
    t=await cap.inner_text('#subBody')
    check('captain does not see contact before yes', '416-555' not in t and 'once they say yes' in t)
    await cap.click('[data-ask]'); await cap.wait_for_timeout(200); await cap.click('text=Send request'); await cap.wait_for_timeout(700)
    await pl.wait_for_timeout(300); await pl.click('text=I\'m in'); await pl.wait_for_timeout(900)
    await cap.wait_for_timeout(500); t=await cap.inner_text('#subBody')
    check('after yes, captain sees contact', '416-555-0100' in t)
    await cap.screenshot(path=OUT+'v2_5_contact.png', full_page=True)

    await pl.click('text=Team menu'); await pl.wait_for_selector('dialog.menu[open]')
    check('player menu has no captain controls', await pl.locator('#mNewCode, [data-kick]').count()==0)
    await pl.click('dialog.menu summary'); await pl.fill('#mDelT','nope'); await pl.click('#mDel .btn'); await pl.wait_for_timeout(200)
    check('delete needs typed confirmation', 'Type DELETE' in await pl.inner_text('#mErr'))
    await pl.fill('#mDelT','DELETE'); await pl.click('#mDel .btn'); await pl.wait_for_timeout(800)
    gone=await cap.evaluate("(()=>{const d=JSON.parse(localStorage.getItem('fake-sb-db'));return !d.team_members.some(m=>m.user_id==='u-pl') && !d.docs.some(x=>x.id==='u-pl')})()")
    check('after deleting, membership, profile and sub data are gone', gone)
    csp=[e for e in errs if 'Content Security Policy' in e or 'Refused' in e]
    check('no Content Security Policy violations', not csp)
    print('ERRORS', errs)
    await b.close()
try: asyncio.run(main())
finally: srv.kill()
print(f'{sum(checks)}/{len(checks)} passed')
