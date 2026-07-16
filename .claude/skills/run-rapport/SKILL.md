---
name: run-rapport
description: Build, run, and drive the "Rapports de mission" static web app (Well'Com Air). Use when asked to start the app, serve it, take a screenshot of its UI, fill in a mission form, generate a report, or interact with the running app in a browser.
---

Rapports de mission is a static, zero-build web app (native ES modules,
no bundler) served by a plain HTTP server. Drive it via the headless
Playwright REPL at `.claude/skills/run-rapport/driver.mjs` — there is no
`chromium-cli` in this environment, so this driver stands in for it,
using the pre-installed Chromium at `/opt/pw-browsers/chromium`.

All paths below are relative to the repo root (`/home/user/rapport`).

Most PRs on this project touch `src/core/*.js` (pure logic — parser,
report, mission rules) with zero DOM. For those, `npm test` alone is
the fast path and the driver isn't needed — see **Test** below. Reach
for the driver when the change touches `src/ui/app.js`, `index.html`,
or `src/styles/main.css` (anything with a DOM/rendering surface).

## Prerequisites

Nothing beyond what's already in this container: Node.js, and Chromium
pre-installed at `/opt/pw-browsers/chromium` (`PLAYWRIGHT_BROWSERS_PATH`
is already set — do not run `playwright install`).

## Setup

```bash
npm install                        # pdfjs-dist (tests) — already present if repo was cloned via git
npm install --save-dev playwright-core   # only needed once; used solely by the driver
```

No build step. `CLAUDE.md` in the repo root has the full architecture
write-up if you need more context than this file gives.

## Run (agent path)

Start the static file server, then the driver, in tmux so you can poll
for output instead of guessing sleep durations:

```bash
nohup npm run serve > /tmp/rapport-serve.log 2>&1 & disown
timeout 15 bash -c 'until curl -sf http://localhost:8080/index.html >/dev/null; do sleep 0.5; done'

tmux new-session -d -s rapportdriver -x 200 -y 50
tmux send-keys -t rapportdriver 'node .claude/skills/run-rapport/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t rapportdriver -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t rapportdriver 'launch' Enter
timeout 20 bash -c 'until tmux capture-pane -t rapportdriver -p | grep -q "launched\."; do sleep 0.3; done'
tmux send-keys -t rapportdriver 'ss landing' Enter
timeout 10 bash -c 'until tmux capture-pane -t rapportdriver -p | tail -2 | grep -q "screenshot:"; do sleep 0.3; done'
```

Screenshots land in `/tmp/shots/` (override with `SCREENSHOT_DIR`). The
app URL defaults to `http://localhost:8080/index.html` (override with
`APP_URL` if you serve on a different port).

**Send one command at a time and wait for its echoed result before
sending the next** (poll `tmux capture-pane` for the expected output,
same pattern as above). The driver serializes commands internally so
concurrent ones can no longer corrupt each other's input — but you
still won't see a given command's result until it actually runs, so
polling is how you know it's safe to read the screen.

### Driver commands

| command | what it does |
|---|---|
| `launch` | launch headless Chromium, navigate to `APP_URL` |
| `nav <url>` | navigate to a different URL |
| `ss [name]` | full-page screenshot → `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element via DOM `.click()` |
| `click-text <text>` | click first button/link/`.btn`/`.chip` whose text matches (no quotes — see Gotchas) |
| `fill <css-sel> <value>` | Playwright `fill()` — goes through the real input pipeline, fires `oninput=` handlers |
| `select <css-sel> <value>` | `selectOption()` — use this for `<select>` dropdowns, not `fill` |
| `type <text>` | keyboard-type into whatever is currently focused |
| `press <key>` | press a single key (e.g. `Enter`, `Escape`) |
| `wait <css-sel>` | wait up to 10s for an element to appear |
| `eval <js>` | evaluate a JS expression in the page, print JSON |
| `text [css-sel]` | print `innerText` of an element (or `body`) |
| `quit` | close the browser, exit |

Example — add a manual mission, fill it, generate the report:

```bash
tmux send-keys -t rapportdriver 'eval window.addManualMission()' Enter
tmux send-keys -t rapportdriver 'fill #m0_booking 30624' Enter
tmux send-keys -t rapportdriver 'fill #m0_pax 2' Enter
tmux send-keys -t rapportdriver 'fill #m0_vol ua272' Enter
tmux send-keys -t rapportdriver 'fill #m0_terminal 1' Enter
tmux send-keys -t rapportdriver 'fill #m0_client ACA ETIC' Enter
tmux send-keys -t rapportdriver 'click-text Générer le rapport' Enter
tmux send-keys -t rapportdriver 'eval document.querySelector("#m0_pre").textContent' Enter
```

Mission form field ids follow `#m<index>_<name>` (e.g. `#m0_booking`,
`#m0_vol`, `#m0_client`, `#m0_pax`, `#m0_terminal`) — see `fieldId()` in
`src/ui/app.js`. The generated report text lives in `#m<index>_pre`.

Stop everything when done:

```bash
tmux send-keys -t rapportdriver 'quit' Enter
tmux kill-session -t rapportdriver
pkill -f 'http.server 8080'
```

## Run (human path)

```bash
npm run serve   # → http://localhost:8080 — open in a real browser. Ctrl-C to stop.
```

Opening `index.html` directly via `file://` does **not** work — ES
module imports are blocked by CORS without a real HTTP origin.

## Test

```bash
npm test
```

Runs `tests/parser.test.js`: unit tests on the pure core (phone
parsing, validation, NO SHOW, report text, place defaults) plus PDF
integration tests against fixtures in `tests/fixtures/`. Expect
`9 réussis, 0 échoués` with one `⚠️ fixture absente` line (a reference
PDF not committed to the repo — harmless). This is the fast path for
any change confined to `src/core/*.js`; no browser needed.

## Gotchas

- **Don't wrap `click-text`/`fill` values in shell quotes when sending
  through `tmux send-keys`.** tmux types the literal characters into
  the driver's stdin — it does not interpret shell quoting. Sending
  `click-text '+ Ajouter une mission manuelle'` makes the driver search
  for text that literally starts with a `'` character and fails with
  `NOT_FOUND`. Send `click-text + Ajouter une mission manuelle`
  (unquoted) instead.
- **`fill` only works on `<input>`/`<textarea>`.** For the porter
  `<select id="porterSelect">` (or any dropdown), use `select`
  (`selectOption`), not `fill` — `fill()` throws on a `<select>`.
- **Commands are serialized inside the driver on purpose.** Firing
  several `tmux send-keys ... Enter` in a row without waiting queues
  them safely now, but the *visible* echo in `capture-pane` can lag
  behind what you sent — always poll for the specific output string
  you expect (e.g. `grep -q 'launched\.'`) rather than a fixed `sleep`,
  and rather than assuming the Nth line corresponds to the Nth command.
  Before this was fixed, unserialized concurrent `fill()` calls raced
  on the same page and corrupted each other's keystrokes (a `fill
  #m0_pax 2` immediately followed by `fill #m0_vol ua272` produced
  `vol = "2UA272"` and left `pax` empty) — this is why the driver
  queues commands through a promise chain instead of firing the
  readline `line` handler concurrently.
- **New mission cards render already expanded** (`isOpen` true on
  creation), so you don't need to click anything to see/fill their
  fields right after `addManualMission()` or extraction.
- **The mission card banner never shows "Booking" as a word** — by
  design (see `CLAUDE.md` §4). It shows the raw booking number, plus
  `· HH:MM` only when `sortTime` is known (`9999` = unknown, e.g. fresh
  manual missions — no time shown, and that's correct, not a bug).
