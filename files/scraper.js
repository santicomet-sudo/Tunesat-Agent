import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const COOKIES_DIR = './data/cookies';
const MAX_RETRIES = 3;

// Username de Tunesat por slot (subscriber_user de las cookies)
const TUNESAT_USERNAMES = {
  1: 'santicomet',
  2: 'fisionboy',
  3: 'Perico',
  4: 'lacantinasonora',
  5: 'Martavigara',
  6: 'santisaezcomet',
  7: 'cometronix',
  8: 'aupahelsinki',
};

function buildUrl(tunesatUser, page) {
  const params = new URLSearchParams({
    tz: 'ce',
    filter_country: '',
    filter_layer: '0',
    filter_track: tunesatUser,
    filter_channel: '',
    filter_startdate: '',
    filter_starttime_hh: '',
    filter_starttime_mm: '',
    filter_starttime_ampm: '',
    filter_enddate: '',
    filter_endtime_hh: '',
    filter_endtime_mm: '',
    filter_endtime_ampm: '',
    filter_show: '',
    filter_episode: '',
    filter_path: '',
    filter_notes: '',
    filter_utype: '',
    filter_usage: '',
    filter_group: '',
    filter_title: '',
    filter_album: '',
    filter_artist: '',
    filter_composer: '',
    filter_publisher: '',
    filter_custom: '',
    results_sortkey: 'datebroadcast',
    pagesize: '500',
    page: String(page),
  });
  return `https://tunesat.com:4433/v2/detections/index.pl?${params.toString()}`;
}

export function getAccounts() {
  const names = (process.env.ACCOUNT_NAMES || '').split(',').map(n => n.trim());
  const accounts = [];
  for (let i = 1; i <= 8; i++) {
    const user = process.env[`TUNESAT_USER_${i}`];
    const pass = process.env[`TUNESAT_PASS_${i}`];
    if (user && pass && !user.startsWith('email_cuenta')) {
      accounts.push({
        index: i,
        name: names[i-1] || `Slot${i}`,
        user,
        pass,
        tunesatUser: TUNESAT_USERNAMES[i] || '',
      });
    }
  }
  return accounts;
}

export function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadCookies(account) {
  const p = path.join(COOKIES_DIR, `cookies_${account.index}.json`);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  return null;
}

function saveCookies(account, cookies) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(COOKIES_DIR, `cookies_${account.index}.json`),
    JSON.stringify(cookies, null, 2)
  );
}

function isSessionExpired(url) {
  return url.includes('portal.tunesat.com') || !url.includes('4433');
}

async function waitForDataRows(page, timeout) {
  timeout = timeout || 15000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const rows = await page.locator('table tr').all();
    for (const row of rows) {
      const cells = await row.locator('td').all();
      if (cells.length === 9) {
        const t = await cells[2].innerText().catch(function() { return ''; });
        if (t.match(/^\d+:\d+$/)) return true;
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function parseTableRows(page) {
  const detections = [];
  const rows = await page.locator('table tr').all();
  for (const row of rows) {
    const cells = await row.locator('td').all();
    if (cells.length !== 9) continue;
    const texts = await Promise.all(cells.map(function(c) {
      return c.innerText().then(function(t) { return t.trim(); });
    }));
    if (!texts[2] || !texts[2].match(/^\d+:\d+$/)) continue;
    detections.push({
      duration: texts[2] || '',
      datetime: texts[3] || '',
      channel:  texts[4] || '',
      show:     texts[5] || '',
      episode:  texts[6] || '',
      usage:    texts[7] || '',
      filename: texts[8] || '',
      date:     texts[3] ? texts[3].split(' ')[0] : '',
      time:     texts[3] ? texts[3].split(' ').slice(1).join(' ') : '',
      title:    texts[8] ? texts[8].replace('.wav','').replace('.mp3','') : '',
      country:  '',
    });
  }
  return detections;
}

async function extractDetections(page, account) {
  const allDetections = [];
  let pageNum = 1;

  while (true) {
    const url = buildUrl(account.tunesatUser, pageNum);
    console.log('     🔗 Página ' + pageNum + ': ' + url.slice(0, 80) + '...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    if (isSessionExpired(page.url())) {
      console.warn('     ⚠️  Sesión expirada para ' + account.name + ' — renueva con setup_cookies.mjs');
      break;
    }

    const hasData = await waitForDataRows(page, 10000);
    if (!hasData) {
      // No hay datos en esta página — fin de la paginación
      console.log('     ✅ Sin más páginas');
      break;
    }

    const rows = await parseTableRows(page);
    allDetections.push(...rows);
    console.log('     📄 Página ' + pageNum + ': ' + rows.length + ' filas  (acumulado: ' + allDetections.length + ')');

    // Si trajo menos de 500, es la última página
    if (rows.length < 500) break;

    pageNum++;
    if (pageNum > 40) {
      console.warn('     ⚠️  Límite de seguridad: 40 páginas');
      break;
    }
  }

  return allDetections;
}

async function scrapeAccount(browser, account) {
  const result = { account: account.name, date: getTodayStr(), detections: [], error: null };
  const cookies = loadCookies(account);
  if (!cookies) { result.error = 'Sin cookies'; return result; }
  if (!account.tunesatUser) { result.error = 'Sin tunesatUser configurado'; return result; }

  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log('     🔄 Reintento ' + attempt + '/' + MAX_RETRIES);
        await page.waitForTimeout(3000);
      }
      result.detections = await extractDetections(page, account);
      console.log('   ✅ ' + account.name + ': ' + result.detections.length + ' detecciones en total');
      saveCookies(account, await context.cookies());
      break;
    } catch(err) {
      console.warn('     ⚠️  Intento ' + attempt + ' fallido: ' + err.message);
      if (attempt === MAX_RETRIES) result.error = err.message;
    }
  }

  await context.close();
  return result;
}

export async function runScraper() {
  const accounts = getAccounts();
  if (accounts.length === 0) throw new Error('No hay cuentas en el .env');
  const conCookies = accounts.filter(function(a) { return loadCookies(a); });
  const sinCookies = accounts.filter(function(a) { return !loadCookies(a); });
  if (sinCookies.length > 0) console.log('\n⚠️  Sin cookies: ' + sinCookies.map(function(a) { return a.name; }).join(', '));
  if (conCookies.length === 0) throw new Error('Ninguna cuenta tiene cookies.');
  console.log('\n🎵 Scraping ' + conCookies.length + ' cuentas...');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (let i = 0; i < conCookies.length; i += 3) {
    const batch = conCookies.slice(i, i + 3);
    const br = await Promise.all(batch.map(function(acc) { return scrapeAccount(browser, acc); }));
    results.push(...br);
  }
  sinCookies.forEach(function(a) {
    results.push({ account: a.name, date: getTodayStr(), detections: [], error: 'Sin cookies' });
  });
  await browser.close();
  return results;
}

export async function runScraperSanti() {
  const accounts = getAccounts();
  const santi = accounts.find(function(a) { return a.index === 6; });
  if (!santi) throw new Error('Cuenta slot 6 no encontrada');
  if (!loadCookies(santi)) throw new Error('Sin cookies para santisaezcomet');
  console.log('\n🎯 Modo santisaezcomet — hoy (' + getTodayStr() + ')\n');
  const browser = await chromium.launch({ headless: true });
  const result = await scrapeAccount(browser, santi);
  await browser.close();
  const today = getTodayStr();
  const hoy = result.detections.filter(function(d) {
    if (!d.date) return false;
    const parts = d.date.split('/');
    if (parts.length === 3) {
      const mm = parts[0], dd = parts[1], yy = parts[2];
      const iso = '20' + yy.padStart(2,'0') + '-' + mm.padStart(2,'0') + '-' + dd.padStart(2,'0');
      return iso === today;
    }
    return d.date === today;
  });
  result.detections = hoy;
  console.log('📅 Detecciones de hoy para santisaezcomet: ' + hoy.length);
  return [result];
}
