// REPL driver for the "Rapports de mission" static web app.
// Run on headless Linux (no xvfb needed — headless Chromium via playwright-core).
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output.
//
// Requires the local server already running (see SKILL.md — `npm run serve`)
// and playwright-core installed (`npm install --save-dev playwright-core`).
// Uses the environment's pre-installed Chromium at PLAYWRIGHT_CHROMIUM_PATH
// (defaults to /opt/pw-browsers/chromium, the path baked into this container).
import { chromium } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = process.env.APP_URL || 'http://localhost:8080/index.html';
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let page = null;

// `sel value` -> [sel, value], splitting only on the first space so the
// value itself can contain spaces (e.g. `fill #m0_client ACA ETIC`).
function splitArg(args) {
  const sp = args.indexOf(' ');
  return sp === -1 ? [args, ''] : [args.slice(0, sp), args.slice(sp + 1)];
}

// Commands not in this set require `page` to be set (i.e. `launch` already
// ran) — checked once in runLine() instead of repeating the guard in every
// handler below.
const NO_PAGE_REQUIRED = new Set(['launch', 'help', 'quit']);

const COMMANDS = {
  async launch() {
    if (browser) return console.log('already launched');
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
    await page.goto(BASE_URL, { waitUntil: 'load' });
    console.log('launched. url:', page.url());
  },

  async nav(url) {
    await page.goto(url || BASE_URL, { waitUntil: 'load' });
    console.log('nav ->', page.url());
  },

  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f, fullPage: true });
    console.log('screenshot:', f);
  },

  // DOM click via evaluate(), not locator.click() — the app's onclick=
  // handlers are plain inline attributes, and evaluate() sidesteps any
  // Playwright actionability waits that aren't needed on this simple DOM.
  async click(sel) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '->', r);
  },

  // Matches any element with an inline onclick= handler — the app's sole
  // interactivity pattern (see CLAUDE.md: every handler is wired via
  // onclick=/onchange= and exposed on `window`), so this covers buttons,
  // chips, and any future clickable element without needing a tag/class
  // allowlist that drifts from the markup.
  async 'click-text'(text) {
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('[onclick]')];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK: ' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '->', r);
  },

  // fill() goes through Playwright's real input pipeline, which fires the
  // `oninput=` handlers the app relies on (e.g. force-uppercase on vol/client).
  async fill(args) {
    const [sel, value] = splitArg(args);
    await page.fill(sel, value);
    console.log('fill', sel, '=', JSON.stringify(value));
  },

  async select(args) {
    const [sel, value] = splitArg(args);
    await page.selectOption(sel, value);
    console.log('select', sel, '=', JSON.stringify(value));
  },

  // Sets a file <input>'s files directly (Playwright API — no OS file
  // picker involved). Fires the input's `change` listener, same as a real
  // user pick. Path is resolved relative to the process cwd (repo root).
  async upload(args) {
    const [sel, filePath] = splitArg(args);
    await page.setInputFiles(sel, path.resolve(filePath));
    console.log('upload', sel, '<-', filePath);
  },

  async wait(sel) {
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null));
  },

  async type(text) {
    await page.keyboard.type(text, { delay: 30 });
    console.log('typed:', JSON.stringify(text));
  },

  async press(key) {
    await page.keyboard.press(key);
    console.log('pressed:', key);
  },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

// Use the raw fd so nothing upstream can steal stdin from the REPL.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

// Commands are serialized through this promise chain. Without it, lines
// arriving in the same read chunk (e.g. several tmux send-keys fired back
// to back) trigger concurrent page.fill()/click() calls that race on the
// same page — keystrokes from one call have landed in a different field
// mid-fill. One command must finish (and print its own output) before the
// next starts.
let queue = Promise.resolve();

rl.on('line', (line) => {
  queue = queue.then(() => runLine(line));
});

async function runLine(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log('unknown:', cmd, '— try: help');
    return rl.prompt();
  }
  if (!page && !NO_PAGE_REQUIRED.has(cmd)) {
    console.log('ERROR: launch first');
    return rl.prompt();
  }
  try {
    await fn(rest.join(' '));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  if (cmd === 'quit') {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
}
rl.on('close', async () => {
  await COMMANDS.quit();
  process.exit(0);
});

console.log('rapport driver — "help" for commands, "launch" to start');
rl.prompt();
