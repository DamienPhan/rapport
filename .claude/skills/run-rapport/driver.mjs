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
    if (!page) return console.log('ERROR: launch first');
    await page.goto(url || BASE_URL, { waitUntil: 'load' });
    console.log('nav ->', page.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f, fullPage: true });
    console.log('screenshot:', f);
  },

  // DOM click via evaluate(), not locator.click() — the app's onclick=
  // handlers are plain inline attributes, and evaluate() sidesteps any
  // Playwright actionability waits that aren't needed on this simple DOM.
  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '->', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"], .btn, .chip')];
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
    if (!page) return console.log('ERROR: launch first');
    const sp = args.indexOf(' ');
    const sel = sp === -1 ? args : args.slice(0, sp);
    const value = sp === -1 ? '' : args.slice(sp + 1);
    await page.fill(sel, value);
    console.log('fill', sel, '=', JSON.stringify(value));
  },

  async select(args) {
    if (!page) return console.log('ERROR: launch first');
    const sp = args.indexOf(' ');
    const sel = sp === -1 ? args : args.slice(0, sp);
    const value = sp === -1 ? '' : args.slice(sp + 1);
    await page.selectOption(sel, value);
    console.log('select', sel, '=', JSON.stringify(value));
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null));
  },

  async type(text) {
    if (!page) return console.log('ERROR: launch first');
    await page.keyboard.type(text, { delay: 30 });
    console.log('typed:', JSON.stringify(text));
  },

  async press(key) {
    if (!page) return console.log('ERROR: launch first');
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
