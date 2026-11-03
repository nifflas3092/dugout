# Tests

Run these after any change, before pushing.

## Database rules (`tests/database`)

About 90 attacks against `supabase/schema.sql`, each run as a different kind of user: signed out, a stranger, a player, another team's captain. Examples:

- reading another team's data
- answering someone else's RSVP
- deleting another player's post
- reading a sub's phone number without their OK
- faking which team sent a request
- guessing join codes
- flooding the database
- slipping a script into a document id

It also checks that legitimate use keeps working.

You need Postgres 15 or newer on your machine. Point the script at a **throwaway** local database, never your real project.

```
PGPORT=5432 PGUSER=postgres ./tests/database/run.sh
```

## League rules (`tests/rules.test.mjs`)

About 75 checks of the lineup builder against each league's rules, using realistic team mixes: full teams, short-handed teams, too many men, non-binary players and players with no gender set.

```
node tests/rules.test.mjs
```

## Click-through test (`tests/e2e`)

Signs in, creates a team, invites a player, RSVPs, posts, signs up a sub, sends and accepts a request, and deletes an account. It runs in a real browser (Playwright), against an in-browser stand-in for Supabase. It also fails if the Content Security Policy blocks anything.

```
pip install playwright && playwright install chromium
python3 tests/e2e/run.py
```
