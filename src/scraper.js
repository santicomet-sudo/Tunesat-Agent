import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TUNESAT_DETECTIONS = 'https://tunesat.com:4433/v2/detections/index.pl';
const COOKIES_DIR = './data/cookies';

export function getAccounts() {
  const names = (process.env.ACCOUNT_NAMES || '').split(',').map(n => n.trim());
  const accounts = [];
  for (let i = 1; i <= 12; i++) {
    const user = process.env[`TUNESAT_USER_${i}`];
    const pass = process.env[`TUNESAT_PASS_${i}`];
    if (user && pass && !user.startsWith('email_cuenta')) {
      accounts.push({ index: i, name: names[i-1] || `Slot${i}`, user, pass });
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

// ── Extraer filas de la tabla visible en este momento ────────────────────────
async function parseTableRows(page) {
  const detections = [];
  const rows = await page.locator('#maintable_data tr').all();
  for (const row of rows) {
    const cells = await row.locator('td').all();
    if (cells.length < 4) continue;
    const texts = await Promise.all(cells.map(c => c.innerText().then(t => t.trim())));
    if (!texts[2] || !texts[2].match(/^\d+:\d+$/)) continue;
    detections.push({
      duration: texts[2] || '',
      datetime: texts[3] || '',
      channel:  texts[4] || '',
      show:     texts[5] || '',
      episode:  texts[6] || '',
      usage:    texts[7] || '',
      filename: texts[8] || '',
      date:     texts[1] ? texts[3].split(' ')[0] : '',
      time:     texts[1] ? texts[3].split(' ').slice(1).join(' ') : '',
      title:    texts[8] ? texts[8].replace('.wav','').replace('.mp3','') : '',
      country:  '',
    });
  }
  return detections;
}

// ── PASO 1: Cambiar desplegable a 500 por página ─────────────────────────────
async function setPageSize500(page) {
  try {
    // Buscar el <select> que tenga una opción con "500"
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      const opts = await sel.locator('option').allInnerTexts();
      const opt500 = opts.find(o => o.includes('500'));
      if (opt500) {
        await sel.selectOption({ label: opt500 });
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForTimeout(1500);
        console.log('     📋 Desplegable → 500 por página');
        return true;
      }
    }
    console.warn('     ⚠️  No se encontró el desplegable de tamaño de página');
    return false;
  } catch(e) {
    console.warn(`     ⚠️  Error al cambiar desplegable: ${e.message}`);
    return false;
  }
}

// ── PASO 2: Pulsar "Count Results" y leer el total ───────────────────────────
async function clickCountResults(page) {
  try {
    await page.waitForSelector('input[value="Count Results"]', { timeout: 10000 }).catch(() => {});
    const countBtn = page.locator('input[value="Count Results"]').first();
    const exists = await countBtn.count();
    if (!exists) {
      console.warn('     ⚠️  Botón "Count Results" no encontrado');
      return null;
    }
    await countBtn.evaluate(el => el.click());
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await page.waitForTimeout(1500);

    // Leer el total: "624 results in account"
    const totalText = await page.locator('text=/\\d+ results in account/').first()
      .innerText({ timeout: 5000 }).catch(() => '');
    const m = totalText.match(/(\d+)/);
    const total = m ? parseInt(m[1]) : null;
    console.log(`     📊 Count Results: ${total ?? '?'} detecciones en la cuenta`);
    return total;
  } catch(e) {
    console.warn(`     ⚠️  Error al pulsar Count Results: ${e.message}`);
    return null;
  }
}

// ── PASO 3: Paginar con ">" y acumular todas las detecciones ─────────────────
async function collectAllPages(page) {
  const allDetections = [];
  let pageNum = 1;

  while (true) {
    const rows = await parseTableRows(page);
    allDetections.push(...rows);
    console.log(`     📄 Página ${pageNum}: ${rows.length} filas  (acumulado: ${allDetections.length})`);

    // Leer número de página actual para detectar si avanzamos
    const currentPage = await page.locator('input[type="text"]').first()
      .inputValue({ timeout: 2000 }).catch(() => null);

    // Flecha ">" — puede ser input[value=">"] o input[type="image"]
    let advanced = false;
    const nextBtn = page.locator('input[value=">"]').first();
    const nextVisible = await nextBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (nextVisible) {
      const disabled = await nextBtn.evaluate(el =>
        el.disabled || el.classList.contains('disabled') || el.classList.contains('off')
      ).catch(() => false);
      if (disabled) break;
      await nextBtn.click();
      advanced = true;
    } else {
      // Fallback: input de imagen con src que contenga "right" o "next"
      const imgBtn = page.locator('input[type="image"][src*="right"], input[type="image"][src*="next"]').first();
      const imgVisible = await imgBtn.isVisible({ timeout: 1000 }).catch(() => false);
      if (!imgVisible) break;
      await imgBtn.click();
      advanced = true;
    }

    if (!advanced) break;

    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await page.waitForTimeout(1500);

    // Verificar que la página realmente cambió
    const newPage = await page.locator('input[type="text"]').first()
      .inputValue({ timeout: 2000 }).catch(() => null);
    if (newPage !== null && newPage === currentPage) break;

    pageNum++;
    if (pageNum > 40) {
      console.warn('     ⚠️  Límite de seguridad: 40 páginas × 500 = 20 000 detecciones');
      break;
    }
  }

  return allDetections;
}

// ── Orquestador: los tres pasos en orden ─────────────────────────────────────
async function extractDetections(page) {
  try {
    await page.waitForSelector('table tr', { timeout: 15000 });
  } catch(_) { return []; }
  await page.waitForTimeout(1500);

  // 1️⃣  Cambiar desplegable a 500 per page
  await setPageSize500(page);

  // 2️⃣  Pulsar Count Results (ahora calcula sobre 500/pág)
  await clickCountResults(page);

  // 3️⃣  Recoger todas las páginas
  return await collectAllPages(page);
}

async function scrapeAccount(browser, account) {
  const result = { account: account.name, date: getTodayStr(), detections: [], error: null };
  const cookies = loadCookies(account);
  if (!cookies) { result.error = 'Sin cookies'; return result; }

  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto(TUNESAT_DETECTIONS, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    if (!page.url().includes('4433')) {
      result.error = 'Sesion expirada — ejecuta setup_cookies.mjs';
      await context.close();
      return result;
    }
    result.detections = await extractDetections(page);
    console.log(`   ✅ ${account.name}: ${result.detections.length} detecciones en total`);
    saveCookies(account, await context.cookies());
  } catch(err) {
    result.error = `Error: ${err.message}`;
    console.error(`   ❌ ${account.name}: ${err.message}`);
  } finally { await context.close(); }
  return result;
}

export async function runScraper() {
  const accounts = getAccounts();
  if (accounts.length === 0) throw new Error('No hay cuentas en el .env');
  const conCookies = accounts.filter(a => loadCookies(a));
  const sinCookies = accounts.filter(a => !loadCookies(a));
  if (sinCookies.length > 0) console.log(`\n⚠️  Sin cookies: ${sinCookies.map(a => a.name).join(', ')}`);
  if (conCookies.length === 0) throw new Error('Ninguna cuenta tiene cookies.');
  console.log(`\n🎵 Scraping ${conCookies.length} cuentas...`);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (let i = 0; i < conCookies.length; i += 3) {
    const batch = conCookies.slice(i, i + 3);
    const br = await Promise.all(batch.map(acc => scrapeAccount(browser, acc)));
    results.push(...br);
  }
  sinCookies.forEach(a => results.push({ account: a.name, date: getTodayStr(), detections: [], error: 'Sin cookies' }));
  await browser.close();
  return results;
}
