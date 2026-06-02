import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debuggingPort = 9223;
const userDataDir = '/private/tmp/chrome-codex-overflow-check';
const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5174/';
const screenshotPath = process.argv[3] ?? '/Users/mingyanghuang/Desktop/美团比赛/交付物/mobile-ui-check.png';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-first-run',
  '--disable-extensions',
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDir}`,
], { stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getDebuggerUrl() {
  const endpoint = `http://127.0.0.1:${debuggingPort}/json/list`;
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const data = await response.json();
        const page = data.find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not become ready.');
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });

  return {
    send(method, params = {}) {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

const client = await connect(await getDebuggerUrl());

try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await client.send('Page.navigate', { url: targetUrl });
  await sleep(1200);

  const metrics = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const root = document.documentElement;
      const body = document.body;
      const offenders = Array.from(document.querySelectorAll('*'))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            className: String(el.className || ''),
            text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width)
          };
        })
        .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.right > window.innerWidth + 1)
        .slice(0, 20);
      return {
        innerWidth: window.innerWidth,
        rootClientWidth: root.clientWidth,
        rootScrollWidth: root.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        offenders
      };
    })()`,
  });

  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(metrics.result.value, null, 2));
} finally {
  client.close();
  chrome.kill('SIGTERM');
}
