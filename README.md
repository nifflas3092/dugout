# Dugout

Team app for rec league slowpitch:

- schedule and RSVPs
- fair lineups
- live scoring and season stats
- a team board
- a league-wide sub finder with distance search
- **game-day weather**: each upcoming game shows the forecast for its park and flags likely rain-outs, and the schedule tracks rained-out games until a makeup is scheduled
- **League rules**: pick Standard, **OttawaSoftball (co-ed)** or **OSSC (Ottawa Sport & Social Club, mixed)** when you start a team or in Team settings. The lineup builder follows the league's batting-order and field rules (OttawaSoftball: max 2 men in a row, 4 women and max 6 men in the field, 3 women rotate through 4 spots; OSSC: max 2 of the same gender in a row, 8 positions plus a rover, the batting team pitches). Scoring shows the run limit, mercy rule, home-run limit and game clock; game cards warn when you're short of a gender and offer a sub search
- **Gameday view**: game time, the field with one-tap directions, the forecast, your batting spot and starting position, who's pitching and the starting lineup
- **Team notice banner**: captains post a red or orange notice ("Games cancelled tonight: fields closed") at the top of everyone's app, optionally clearing itself at midnight
- **Lineup sharing**: send the batting order and positions by inning to the team chat as text, or save it as an image
- **Team messages**: one tap sends an RSVP reminder (with who hasn't answered), a rain-out notice or a makeup date to your team's WhatsApp or text group
- **Digital scorecard**: a scorebook grid (a row per batter, a box per inning) that fills in as you score. Tap the play (single, groundout, sac fly, double play…), optionally tap who fielded it, check where each runner ended up (Dugout moves them for you), and save. Runs, RBIs, outs and the side changing are worked out automatically, with standard notation (6-3, F8, K) and base paths drawn in each box. Undo is exact; box score and season stats update live
- **Gear**: a used-equipment marketplace with photos, filters, and private messages between buyer and seller
- **Accounts**: log in with email and password, create an account, reset a forgotten password, log out or log out everywhere, change password. Display settings (text size up to extra large, light/dark, high contrast, reduce motion, underlined links) on the sign-in screen and in the menu
- **Plans**: everyone signs up free as a player. The **captain plan ($5/month)** unlocks starting teams, the master sub list and AI schedule import, with no ads. Anyone can **remove ads forever ($7.99, one payment)**. Captains from before plans existed stay free
- **Team chat**: live chat for each team, with unread counts
- **Online now**: captains see a green light on subs who have Dugout open (subs can switch it off)
- **AI schedule import**: paste a link to the league's schedule (web page, PDF, calendar or text). Claude reads it, finds your games and diamonds, and you confirm before they're added
- **Calendar sync**: a private link that puts every game from all your teams in Google, Apple or Outlook Calendar, with the diamond's address and a map link. It updates itself
- **Diamonds**: every park and diamond the league uses, nearest first, with Google Maps directions

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

1. In **Authentication → Sign In / Providers → Email**, keep **Email** on and **Confirm email** on (people confirm their address once, by tapping the link in the email). Set the minimum password length to **8**.
2. Go to **Authentication → URL Configuration**. Set **Site URL** to your website's address and add it under **Redirect URLs** (you'll get the address in step 3; come back for this).
4. Before inviting real teams, set up **custom SMTP**. The built-in sender only manages a couple of emails an hour.
   - [Resend](https://resend.com) has a free tier.
   - Turn off link tracking in your email provider.

### 3. Put it online

1. Sign up at **vercel.com** with GitHub.
2. Choose **Add New → Project**, import the `dugout` repo and click **Deploy**. There's nothing to configure.
3. Every push to GitHub now redeploys the site automatically.
4. The security headers in `vercel.json` are applied for you. Netlify works the same way using `netlify.toml`.

### 3a. Server functions (payments, AI import, calendar)

These run on Supabase. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:

```
supabase login
supabase link --project-ref btshfjneizmnqgkrcwvb
supabase functions deploy create-checkout
supabase functions deploy billing-portal
supabase functions deploy import-schedule
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy calendar --no-verify-jwt
supabase secrets set ALLOWED_ORIGINS=https://dugout-one-sand.vercel.app
```

(`--no-verify-jwt` is for the two that are called by Stripe and by calendar apps, which can't sign in. They check a Stripe signature and a long private link instead.)

### 3b. Get paid (Stripe)

1. Sign up at **stripe.com**. Stay in **Test mode** until you've tried it end to end.
2. **Product catalogue → Add product**:
   - "Dugout Captain", **recurring**, $5.00 CAD monthly. Copy its price id (`price_…`).
   - "Dugout: no ads", **one-off**, $7.99 CAD. Copy its price id.
3. **Developers → Webhooks → Add endpoint**: `https://btshfjneizmnqgkrcwvb.supabase.co/functions/v1/stripe-webhook`, with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret (`whsec_…`).
4. **Settings → Billing → Customer portal**: turn on cancelling and updating the payment method.
5. Save the keys as secrets (never in `config.js` or GitHub):
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… STRIPE_PRICE_CAPTAIN=price_… STRIPE_PRICE_ADFREE=price_…
   ```
6. Test with card `4242 4242 4242 4242`. When it works, switch Stripe to live mode, make the same two products, and set the live keys.
7. If you change prices, update `CAPTAIN_PRICE` and `ADFREE_PRICE` in `config.js` so the app shows the right amount.

You collect sales tax yourself unless you turn on Stripe Tax. Ask an accountant once you're earning.

### 3c. AI schedule import

1. Get an API key at **console.anthropic.com** and add a spending limit (Settings → Limits).
2. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…`
3. Optional: `supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5-5` for harder schedules (the default, `claude-haiku-5-5`, is cheaper). One import usually costs well under a cent.

Only paid captains can import, up to 20 times a day each. The function refuses private network addresses and files over 4 MB.

### 3d. Ads

Free players see small house ads (for the captain plan, Gear and removing ads) on Home, Schedule, Team, Diamonds and Gear. Captains and anyone who paid see none. To run real ads later (for example Google AdSense), the slot is `houseAd()` in `js/app.js`; you'd also need to add the ad network to the Content-Security-Policy in `index.html`, `vercel.json` and `netlify.toml`, and ask for consent before personalised ads.

### 3e. Turn on game forecasts

1. On the **Team** tab, under Team settings, enter your **home area** (a postal code is best).
2. When you add a game, you can also pick a specific park from the sub finder's diamonds.

Forecasts come from MET Norway and cover about the next 9 days. They're free to use commercially as long as the "Forecast from MET Norway" credit stays on the page.

### 4. Try it

1. Open your site on your phone and create an account.
2. Start a team and add a couple of players and a game.
3. Go to **Menu → Share link** and send the link to a friend.
4. Your friend joins, taps **This is me** next to their name, and answers In or Out. You should see it appear live.

### 5. Before launch

- Work through the checklist in [SECURITY.md](SECURITY.md).
- Fill in the bracketed parts of `privacy.html`.
- Buy a domain (about $15 a year) and add it in Vercel under **Settings → Domains**. Then update the URLs from step 2.
- When you change code, bump `VERSION` in `sw.js` so phones pick up the update.

## Updating Slowpitch Showdown

The game lives in `game/` and opens from the Showdown tab. It's a copy of the single-file game from the game chat, adjusted for the site. To update it with a new version:

```
python3 tools/sync-game.py path/to/the-new-game.html
```

The script splits the scripts out (the site's security rules don't run inline scripts), renames it Slowpitch Showdown, adds the Back to Dugout link, starts on Vs CPU, and removes any embedded photo (it stops with an error if a photo is still left). Open `game/` to try it, then commit and push.

## Who can do what

| | Signed out | Any signed-in user | Player | Captain |
|---|---|---|---|---|
| See a team's schedule, roster, stats, board | | | ✓ | ✓ |
| Answer In/Out | | | Own spot only | Anyone |
| Post on the board | | | ✓ (delete own) | ✓ (pin, delete any) |
| Change roster, games, lineup, score | | | | ✓ |
| Invite players, new code, make co-captains | | | | ✓ |
| See the sub list (and who's online) | | Own profile only | Own profile only | Paid captains |
| Start a team, import a schedule | | | | Paid captains |
| Team chat | | | ✓ (delete own) | ✓ (delete any) |
| See a sub's contact details | | | | After they say yes |
| Ask a sub to play | | | | ✓ |
| Mark a game rained out, schedule the makeup | | | | ✓ |
| Browse, list and sell gear | | ✓ | ✓ | ✓ |
| Read a gear conversation | | Only the buyer and seller | | |

The database enforces all of this, not just the app. See [SECURITY.md](SECURITY.md).

## How it's put together

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page and its look (light and dark, phone and desktop) |
| `js/main.js` | Log in, create an account, reset a password, plans and checkout, joining or starting a team, the menu, deleting an account |
| `js/prefs.js` | Display and accessibility settings |
| `supabase/functions/` | Server functions: Stripe checkout, billing and webhook, the AI schedule reader, the calendar feed |
| `js/app.js` | The team app: games, lineup, scoring, stats, roster, subs, board |
| `js/weather.js` | Game-time forecasts from MET Norway and the rain-out risk rules |
| `js/market.js` | The Gear marketplace: browse, sell, photos, messages |
| `js/platform.js` | Connects the app to Supabase (reads, writes, live updates) and place lookup |
| `supabase/schema.sql` | Tables, security rules, validation, and the actions the app calls |
| `tests/` | About 90 attacks on the database rules, plus a click-through browser test. See `tests/README.md` |
| `vercel.json`, `netlify.toml` | Security headers for hosting |
| `game/`, `tools/sync-game.py` | Slowpitch Showdown, and the script that updates it from the game chat |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline loading |

## Ideas for what's next

- Text-message reminders for RSVPs and sub requests (Twilio)
- Player fees collected through Dugout (Stripe Connect)
- A real map of diamonds (Leaflet with OpenStreetMap tiles)
- Gear: featured listings for a small fee, or a shop page for local stores (a natural way for the marketplace to earn)
- Text or push alerts when a game's forecast turns bad, or when a captain marks a rain-out
- App Store and Google Play versions (wrap the site with Capacitor)
- League admin view across teams: standings and a shared schedule
- Error monitoring (for example Sentry's free tier), so you hear about problems before captains do
