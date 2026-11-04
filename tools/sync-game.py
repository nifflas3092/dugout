#!/usr/bin/env python3
"""Update Slowpitch Showdown on the Dugout site from a new version of the game.

Usage:
    python3 tools/sync-game.py path/to/slowpitch-duel.html

Takes the single-file game (as it comes from the game chat or its published page) and rebuilds game/:
  * game/index.html  the page, with the site's head, title and a "Back to Dugout" link
  * game/core.js     the rules and physics script
  * game/game.js     the drawing, input and game-flow script
The scripts are split out because the site's security rules (Content-Security-Policy) don't run inline scripts.

It also makes the site-only changes every time, so nothing is missed:
  * renames Slowpitch Duel to Slowpitch Showdown
  * starts on Vs CPU (online 1v1 needs Claude's game rooms, which the site doesn't have)
  * removes any embedded photo (the bobblehead uses the built-in cartoon face), and refuses to finish if one is left

Nothing is published: check the result, then commit and push as usual.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'game'

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">
<meta name="theme-color" content="#183553">
<link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
<title>Slowpitch Showdown · Dugout</title>"""

BACK_CSS = """.back-dugout { display: inline-block; margin: 0 0 6px; font-size: 14px; color: var(--cream-dim); text-decoration: none; }
.back-dugout:hover, .back-dugout:focus-visible { color: var(--lamp); text-decoration: underline; }
"""

notes = []


def swap(text, old, new, what, required=False):
    """Replace old with new; note it if the game has changed and the text isn't there any more."""
    if old in text:
        return text.replace(old, new)
    if new in text:
        return text
    (fail if required else notes.append)(f'could not find {what}; check it by hand')
    return text


def fail(msg):
    sys.exit(f'sync-game: {msg}')


def main():
    if len(sys.argv) != 2:
        fail('usage: python3 tools/sync-game.py path/to/game.html')
    src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')

    # the published page wraps the game in a small head of its own: keep only the game
    if '<title>' not in src:
        fail('that file has no <title>; is it the game?')
    src = src[src.index('<title>'):]
    src = re.sub(r'</body>\s*</html>\s*$', '', src.rstrip())

    # split the two scripts out
    m_core = re.search(r'<script id="core">(.*?)</script>', src, re.S)
    if not m_core:
        fail('could not find the <script id="core"> block')
    rest = src[m_core.end():]
    m_app = re.search(r'<script>(.*)</script>', rest, re.S)
    if not m_app:
        fail('could not find the main game <script>')
    core, app = m_core.group(1), m_app.group(1)
    markup = src[:m_core.start()] + '<script src="core.js"></script>\n<script src="game.js"></script>' + rest[m_app.end():]
    if re.search(r'<script(?![^>]*\bsrc=)[^>]*>', markup):
        fail('the game has another inline <script>; the site cannot run it')

    # remove any photo face, then make sure no photo is left anywhere
    photo = re.compile(r"\{\s*const im = new Image\(\);.{0,200}?=\s*'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+'\s*;?\s*\}", re.S)
    app, n = photo.subn('/* photo face left out of the site: the cartoon face is used */', app)
    if n:
        notes.append(f'removed {n} embedded photo(s)')
    for name, text in (('game.js', app), ('core.js', core), ('index.html', markup)):
        for big in re.finditer(r'data:image/(?:jpeg|jpg|webp|png|gif);base64,[A-Za-z0-9+/=]{4000,}', text):
            fail(f'{name} still has an embedded image ({len(big.group(0)) // 1024} KB); remove it before publishing')

    # site head, name and back link
    markup = re.sub(r'<title>.*?</title>\s*(<meta name="claude:[^>]*>\s*)*', HEAD + '\n', markup, count=1, flags=re.S)
    markup = swap(markup, '</style>', BACK_CSS + '</style>\n</head>\n<body>', 'the end of the styles', required=True) if '</head>' not in markup \
        else markup.replace('</style>', BACK_CSS + '</style>', 1)
    markup = swap(markup, '<h1>Slowpitch <em>Duel</em></h1>',
                  '<a class="back-dugout" href="../#home">&larr; Back to Dugout</a>\n      <h1>Slowpitch <em>Showdown</em></h1>', 'the menu title')
    markup = markup.rstrip() + '\n</body>\n</html>\n'

    app = app.replace("'SLOWPITCH DUEL'", "'SLOWPITCH SHOWDOWN'")
    app = swap(app, "setMode('online');", "setMode('cpu');", 'the starting mode')
    app = re.sub(r"msg = 'Online play works when[^']*';",
                 "msg = 'Online 1v1 isn’t switched on in Dugout yet. Play Vs CPU, the HR Derby or practice in the meantime.';", app)

    OUT.mkdir(exist_ok=True)
    (OUT / 'index.html').write_text(markup, encoding='utf-8')
    (OUT / 'core.js').write_text('/* Slowpitch Showdown: game rules and physics (no drawing). */\n' + core, encoding='utf-8')
    (OUT / 'game.js').write_text('/* Slowpitch Showdown: input, rendering and game flow. */\n' + app, encoding='utf-8')
    print(f'game/ rebuilt: index.html {len(markup) // 1024} KB, core.js {len(core) // 1024} KB, game.js {len(app) // 1024} KB')
    for n in notes:
        print(' -', n)


if __name__ == '__main__':
    main()
