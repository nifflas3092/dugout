# Dugout security

How Dugout protects people's data, what was checked, and the settings you must turn on in Supabase before launch.

## The threat model in one paragraph

Dugout's public key ships inside the website, as it does for every Supabase app. So anyone can skip the app and talk to the database directly. Every rule therefore has to live **in the database**, not just in the app's screens. The app hiding a button doesn't stop anyone.

The other big risk is script injection. Sign-in sessions are kept in the browser, so if someone sneaks a script into a name or note that other people view, they could take over those people's accounts.

The two most common ways apps like this leak data are:

- missing or loose database rules (OWASP's #1 risk, "Broken Access Control")
- privileged database functions left open

## What the database enforces (`supabase/schema.sql`)

**Signed-out visitors**
- Can't read, write or call anything.

**Team data**
- Visible only to that team's members.
- Only captains can change the roster, games, lineups and scores.
- A player can answer RSVPs only for the roster spot linked to their own account ("This is me"). One spot per person, first come first served; a captain can unlink a mistake.
- Players can post and delete their own posts. Only captains can pin posts or delete other people's.

**Sub list**
- Every signed-in user can see sub profiles.
- Contact details live in a separate private collection. A captain sees them only after the sub accepts that captain's request.
- Sub requests are visible only to the captain who sent them and the sub they're for.
- The database stamps the team name and sender on each request; the app can't fake them.
- A sub can only answer a request. A captain can't mark their own request as accepted.

**Validation, on every write**
- Document ids must be letters, digits, `-` or `_`. This blocks script injection through ids.
- Only known collections are allowed, and team data and the global sub list can't be mixed.
- Each document is limited to 32 KB.
- Text lengths are limited.
- Sub profile fields must match the app's own options. Locations are rounded to about 1 km on the server.
- Who wrote a row can't be faked.

**Abuse limits**
- Each person can create up to 120 documents a minute and send up to 30 sub requests an hour.
- Joining a team allows up to 10 tries an hour.
- Team codes are 8 characters from 31 unambiguous letters and digits (about 850 billion possible codes).
- Captains can issue a new code if a link leaks.

**Teams**
- A team always keeps at least one captain while it has members.
- When the last member leaves, the team and its data are deleted.
- Membership and team codes can only change in the intended ways. Column-level permissions stop anyone rewriting who a membership belongs to.

**Privileged functions**
- Each one checks who's calling, runs with an empty `search_path`, and can't be called by signed-out users.
- Supabase's default "grant everything to everyone" is revoked first.

**Account deletion**
- Users can delete their account in the app. This removes their sign-in, their name, their sub profile and requests, and their board posts. Captaincy passes to another member first.

Every rule above has an attack in `tests/database/attack.py` that tries to break it.

## What the website enforces

- **Escaping:** everything shown on screen that came from the database is escaped, including attribute values and document ids.
- **Content Security Policy** (in `vercel.json` and `netlify.toml`, with a copy in `index.html`):
  - only scripts from this site and the one pinned library may run
  - inline scripts and event handlers are blocked, so injected script won't run even if one slipped through
  - the page can't be framed by other sites
- **Pinned library:** the Supabase library is pinned to one version (2.118.0), and the browser checks its hash before running it. If the CDN ever served anything else, it wouldn't run. When you upgrade, update the version and the hash together.
- **Other security headers:** `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.
- **Sign-out:** clears Dugout's data from the device.

## Turn these on in Supabase before real teams use it

**Authentication**
- [ ] **Authentication → Emails → Magic Link template:** include the code so people can type it. Phone mail apps often open links in a different browser, where the link fails. Add a line like `Your Dugout code: {{ .Token }}` above the link.
- [ ] **Authentication → Providers → Email:** set the OTP expiry to **3600 seconds** or less.
- [ ] **Authentication → SMTP:** set up custom SMTP, for example Resend. The built-in sender allows only a couple of emails an hour.
  - Turn **off** link tracking in your email provider, because it breaks sign-in links.
- [ ] **Authentication → Rate Limits:** review them. Supabase's defaults are reasonable once SMTP is set up.
- [ ] **Authentication → Attack Protection:** turn on CAPTCHA if you see sign-up spam. This needs a small app change; ask before turning it on.
- [ ] **Authentication → URL Configuration:** set the Site URL and Redirect URLs to your exact domain only. No wildcards.

**Database**
- [ ] **Database → Settings → SSL Configuration:** enforce SSL.
- [ ] **Advisors → Security Advisor:** run it and fix anything it flags. Re-run after every schema change.

**Accounts with access to the project**
- [ ] Turn on two-factor authentication on the Supabase account and the GitHub account.
  - Anyone who gets into either can read everything.

**Region and backups**
- [ ] Choose a **Canada (Central)** project region when you create the project. This keeps the privacy policy simple.
- [ ] Backups: free projects can't download backups and pause after a week of inactivity. Once real teams depend on Dugout, move to the Pro plan, which includes daily backups.

**Keys**
- [ ] Never put the **service_role** key anywhere in this project. It bypasses every rule. Only the anon/public key belongs in `config.js`.

## Known limits

**Live updates and deletions**
- Supabase's live updates don't apply security rules to *deletions*.
- Anyone subscribed can therefore see that *some* document with a given random id was deleted from some team. They can't see its contents.
- Ids are random, so this reveals almost nothing. If it ever matters, switch to soft-deletes or Supabase's private broadcast channels.

**Sub list visibility**
- Anyone can create an account and see the sub list: names, positions and rough areas. Contact details stay hidden.
- That's the point of a public sub list. If abuse shows up, restrict viewing to captains.

## Reporting a problem

Email [YOUR EMAIL]. If you find a hole, please don't test it on other people's data.
