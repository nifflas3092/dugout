# Dugout

Team app for rec league slowpitch:

- schedule and RSVPs
- fair lineups
- live scoring and season stats
- a team board
- a league-wide sub finder with distance search

It's a plain website with no build step. People open it in a browser or add it to their home screen, where it works like an installed app. Data lives in [Supabase](https://supabase.com), a hosted Postgres database with sign-in. Hosting is free on Vercel or Netlify.

**Before real teams use it, read [SECURITY.md](SECURITY.md)** and tick off its Supabase checklist.

## Launch it (about 45 minutes, all free)

### 1. Create the database

1. Sign up at **supabase.com** and click **New project**.
   - Name it `dugout`.
   - Choose the **Canada (Central)** region.
   - Save the database password in a password manager.
2. Go to **SQL Editor → New query**. Paste the whole of `supabase/schema.sql` and click **Run**.
   - You should see "Success".
   - It's safe to run again whenever this file changes.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into `config.js`. Commit the change.
   - Both values are meant to be public. The database rules protect the data.
   - **Never** use the `service_role` key here.

### 2. Set up sign-in emails

1. Go to **Authentication → Emails → Magic Link**. Add the code to the email, for example: `Your Dugout code: {{ .Token }}`.
   - People type this code into the app.
   - This works even when their mail app opens links in a different browser.
2. In **Authentication → Providers → Email**, set the OTP expiry to **3600**.
3. Go to **Authentication → URL Configuration**. Set **Site URL** to your website's address and add it under **Redirect URLs** (you'll get the address in step 3; come back for this).
4. Before inviting real teams, set up **custom SMTP**. The built-in sender only manages a couple of emails an hour.
   - [Resend](https://resend.com) has a free tier.
   - Turn off link tracking in your email provider.

### 3. Put it online

1. Sign up at **vercel.com** with GitHub.
2. Choose **Add New → Project**, import the `dugout` repo and click **Deploy**. There's nothing to configure.
3. Every push to GitHub now redeploys the site automatically.
4. The security headers in `vercel.json` are applied for you. Netlify works the same way using `netlify.toml`.

### 4. Try it

1. Open your site on your phone and sign in with the emailed code.
2. Start a team and add a couple of players and a game.
3. Go to **Team menu → Share link** and send the link to a friend.
4. Your friend joins, taps **This is me** next to their name, and answers In or Out. You should see it appear live.

### 5. Before launch

- Work through the checklist in [SECURITY.md](SECURITY.md).
- Fill in the bracketed parts of `privacy.html`.
- Buy a domain (about $15 a year) and add it in Vercel under **Settings → Domains**. Then update the URLs from step 2.
- When you change code, bump `VERSION` in `sw.js` so phones pick up the update.

## Who can do what

| | Signed out | Any signed-in user | Player | Captain |
|---|---|---|---|---|
| See a team's schedule, roster, stats, board | | | ✓ | ✓ |
| Answer In/Out | | | Own spot only | Anyone |
| Post on the board | | | ✓ (delete own) | ✓ (pin, delete any) |
| Change roster, games, lineup, score | | | | ✓ |
| Invite players, new code, make co-captains | | | | ✓ |
| See the sub list | | ✓ | ✓ | ✓ |
| See a sub's contact details | | | | After they say yes |
| Ask a sub to play | | | | ✓ |

The database enforces all of this, not just the app. See [SECURITY.md](SECURITY.md).

## How it's put together

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page and its look (light and dark, phone and desktop) |
| `js/main.js` | Sign-in with an emailed code, joining or starting a team, the team menu, deleting an account |
| `js/app.js` | The team app: games, lineup, scoring, stats, roster, subs, board |
| `js/platform.js` | Connects the app to Supabase (reads, writes, live updates) and place lookup |
| `supabase/schema.sql` | Tables, security rules, validation, and the actions the app calls |
| `tests/` | About 90 attacks on the database rules, plus a click-through browser test. See `tests/README.md` |
| `vercel.json`, `netlify.toml` | Security headers for hosting |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline loading |

## Ideas for what's next

- Text-message reminders for RSVPs and sub requests (Twilio)
- Payments for player fees and a paid captain plan (Stripe)
- App Store and Google Play versions (wrap the site with Capacitor)
- League admin view across teams: standings and a shared schedule
- Error monitoring (for example Sentry's free tier), so you hear about problems before captains do
