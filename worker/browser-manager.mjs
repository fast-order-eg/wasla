import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const DEFAULT_ADSPOWER_API = process.env.ADSPOWER_API_URL || 'http://127.0.0.1:50325';

function findLocalChrome() {
  const commonPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of commonPaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export async function checkAdsPower(apiUrl = DEFAULT_ADSPOWER_API) {
  try {
    const res = await fetch(`${apiUrl}/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.code === 0;
  } catch {
    return false;
  }
}

export async function launchBrowser({ profileId, profileName = 'Profile 1', driver = 'auto', headless = false } = {}) {
  const isAdsPowerRunning = driver !== 'local' && await checkAdsPower();

  if (isAdsPowerRunning && profileId) {
    // 1. تشغيل عبر AdsPower Local API
    try {
      const startRes = await fetch(`${DEFAULT_ADSPOWER_API}/api/v1/browser/start?user_id=${profileId}&headless=${headless ? '1' : '0'}`);
      const startData = await startRes.json();
      if (startData.code !== 0) throw new Error(startData.msg || 'فشل تشغيل بروفايل AdsPower');

      const wsEndpoint = startData.data?.ws?.puppeteer;
      if (!wsEndpoint) throw new Error('لم يتم استلام WebSocket من AdsPower');

      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null
      });

      return {
        browser,
        mode: 'adspower',
        profileId,
        close: async () => {
          try { await browser.disconnect(); } catch {}
          try { await fetch(`${DEFAULT_ADSPOWER_API}/api/v1/browser/stop?user_id=${profileId}`); } catch {}
        }
      };
    } catch (err) {
      if (driver === 'adspower') throw err;
      console.warn(`AdsPower failed (${err.message}). Falling back to local stealth browser...`);
    }
  }

  // 2. تشغيل عبر متصفح محلي معزول (Local Isolated Stealth Profile)
  const chromePath = findLocalChrome();
  if (!chromePath) throw new Error('لم يتم العثور على متصفح Chrome أو Edge على الجهاز.');

  const safeProfileName = (profileId || profileName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const userDataDir = path.resolve(ROOT_DIR, 'data', 'browser_profiles', safeProfileName);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: headless ? 'new' : false,
    userDataDir,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,850',
      '--lang=ar-EG,ar,en-US,en'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  return {
    browser,
    mode: 'local_stealth',
    profileId: safeProfileName,
    userDataDir,
    close: async () => {
      try { await browser.close(); } catch {}
    }
  };
}

export async function preparePage(browser) {
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // إخفاء سمات الأتمتة (Stealth overrides)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = parameters => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  return page;
}
