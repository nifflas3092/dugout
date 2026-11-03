# Dugout

Team app for rec league slowpitch: schedule and RSVPs, fair lineups, live scoring, season stats, a team board, and a league-wide sub finder with distance search.

It's a plain website with no build step. People open it in a browser or add it to their home screen, where it works like an installed app. Data lives in [Supabase](https://supabase.com) (a hosted Postgres database with sign-in), and hosting is free on Vercel or Netlify.

## Launch it (about 30 minutes, all free)

### 1. Create the database

1. Sign up at **supabase.com** and click **New project**.
   - Name it `dugout`.
   - Pick the region closest to your players (for example, Canada Central).
   - Save the database password somewhere safe.
2. When the project is ready, go to **SQL Editor → New query**.
3. Paste the whole of `supabase/schema.sql` and click **Run**. You should see "Success".
4. Go to **Project Settings → API** and copy two things:
   - the **Project URL**
   - the **anon public** key
5. Open `config.js` and paste them into `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Commit the change.
   - Both values are designed to be public.
   - The security rules in the schema decide who can read and write what.

### 2. Put it online

1. Sign up at **vercel.com** using your GitHub account.
2. Click **Add New → Project** and import the `dugout` repository.
3. Leave every setting as it is. There's nothing to build. Click **Deploy**.
4. You get a link like `dugout-yourname.vercel.app`. From now on, every push to GitHub redeploys the site automatically.

Netlify works the same way: **Add new site → Import from Git**.

### 3. Point sign-in emails at your site

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel link.
3. Add the same link under **Redirect URLs**.

Without this step, the sign-in links in emails go to the wrong place.

### 4. Try it

1. Open your link and sign in with your email.
2. Click **Start a team**.
3. Open **Team menu → Invite players** and send the link to a friend. When they open it, they join your team.

### 5. Before real leagues use it

- **Email.** Supabase's built-in sender is rate-limited to a few emails an hour, which is fine for testing but not for a league.
  - Set up custom SMTP under **Project Settings → Auth → SMTP**.
  - [Resend](https://resend.com) has a free tier of 3,000 emails a month.
- **Domain.** Buy a domain (about $15 a year) and add it in Vercel under **Settings → Domains**. Then update the URLs from step 3.
- **Privacy page.** Fill in the bracketed parts of `privacy.html`.
- **Place search.** The sub finder uses OpenStreetMap's free place search, which is fine for one league.
  - Beyond that, create a free [Mapbox](https://mapbox.com) token.
  - Put it in `config.js` and set `GEOCODER = 'mapbox'`.
- **Updates.** Whenever you change the code, bump `VERSION` in `sw.js` so phones pick up the new version.

## How it's put together

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page and its look (light and dark mode, phone and desktop layouts) |
| `js/main.js` | Sign-in by email link, joining or starting a team, and the team menu (invite link, members, co-captains, switching teams) |
| `js/app.js` | The team app itself: games, lineup, scoring, stats, roster, subs, board |
| `js/platform.js` | Connects the app to Supabase: reads, writes, live updates, and place lookup |
| `supabase/schema.sql` | Database tables and security rules |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline loading |

**Who can do what.** The database enforces these rules, not just the app:

- **Team members** can see their own team's data, RSVP, and post on the board.
- **Captains** can change the roster, games, lineups and scores, invite and remove people, and make co-captains.
- **Sub profiles** can be seen by any signed-in user, but only their owner can edit them.
- **Sub requests** are visible only to the captain who sent them and the player they were sent to.

## Ideas for what's next

- Text-message reminders for RSVPs and sub requests (Twilio)
- Payments for player fees and a paid captain plan (Stripe)
- App Store and Google Play versions (wrap the site with Capacitor)
- League admin view across many teams: standings and a shared schedule
