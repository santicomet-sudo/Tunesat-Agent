"""
tunesat_scraper.py
Hace login en cada cuenta de Tunesat y descarga las detecciones del día.
Usa Playwright en modo headless (sin abrir ventana).
"""

import asyncio
import os
import json
import csv
import io
from datetime import datetime, timedelta
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# ── Configuración ────────────────────────────────────────────────────────────
TUNESAT_LOGIN_URL = "https://tunesat.com/tunesatportal/home/login"
TUNESAT_DETECTIONS_URL = "https://tunesat.com/tunesatportal/home/detections"
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

ACCOUNT_NAMES = [n.strip() for n in os.environ.get("ACCOUNT_NAMES", "").split(",")]

def get_accounts():
    accounts = []
    for i in range(1, 13):
        user = os.environ.get(f"TUNESAT_USER_{i}")
        pwd  = os.environ.get(f"TUNESAT_PASS_{i}")
        name = ACCOUNT_NAMES[i - 1] if i - 1 < len(ACCOUNT_NAMES) else f"Cuenta{i}"
        if user and pwd:
            accounts.append({"index": i, "name": name, "user": user, "password": pwd})
    return accounts


# ── Scraper por cuenta ───────────────────────────────────────────────────────
async def scrape_account(browser, account: dict, date_str: str) -> dict:
    """Login, filtra por fecha de hoy y devuelve lista de detecciones."""
    result = {
        "account": account["name"],
        "date": date_str,
        "detections": [],
        "error": None,
    }

    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    )
    page = await context.new_page()

    try:
        # 1. Login
        await page.goto(TUNESAT_LOGIN_URL, wait_until="networkidle", timeout=30_000)
        await page.fill('input[name="username"], input[type="email"]', account["user"])
        await page.fill('input[name="password"], input[type="password"]', account["password"])
        await page.click('button[type="submit"], input[type="submit"]')
        await page.wait_for_load_state("networkidle", timeout=20_000)

        # Verificar login exitoso
        if "login" in page.url.lower():
            result["error"] = "Login fallido – verifica usuario/contraseña"
            return result

        # 2. Ir a detecciones
        await page.goto(TUNESAT_DETECTIONS_URL, wait_until="networkidle", timeout=30_000)

        # 3. Intentar exportar CSV del día
        #    Tunesat permite filtrar por fecha y exportar
        detections = await extract_detections_from_page(page, date_str)
        result["detections"] = detections

    except PWTimeout:
        result["error"] = "Timeout – Tunesat tardó demasiado en responder"
    except Exception as e:
        result["error"] = f"Error inesperado: {str(e)}"
    finally:
        await context.close()

    return result


async def extract_detections_from_page(page, date_str: str) -> list:
    """
    Extrae las detecciones de la tabla del dashboard de Tunesat.
    Intenta primero exportar CSV; si no, parsea la tabla HTML.
    """
    detections = []

    # Esperar tabla de detecciones
    try:
        await page.wait_for_selector("table, .detections-table, #detectionsTable", timeout=15_000)
    except PWTimeout:
        return detections

    # Intentar encontrar botón de exportar CSV
    try:
        export_btn = page.locator("text=Export, text=CSV, text=Download").first
        if await export_btn.count() > 0:
            async with page.expect_download(timeout=15_000) as dl_info:
                await export_btn.click()
            download = await dl_info.value
            content = await download.path()
            with open(content, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Filtrar solo filas del día de hoy
                    row_date = row.get("Date", row.get("Fecha", row.get("date", "")))
                    if date_str[:10] in row_date:
                        detections.append(normalize_row(row))
            return detections
    except Exception:
        pass  # Fallback: parsear tabla HTML

    # Fallback: leer tabla HTML directamente
    rows = await page.query_selector_all("table tbody tr")
    for row in rows:
        cells = await row.query_selector_all("td")
        if not cells:
            continue
        texts = [await c.inner_text() for c in cells]
        if len(texts) >= 4:
            detection = {
                "date":     texts[0].strip() if len(texts) > 0 else "",
                "time":     texts[1].strip() if len(texts) > 1 else "",
                "channel":  texts[2].strip() if len(texts) > 2 else "",
                "title":    texts[3].strip() if len(texts) > 3 else "",
                "duration": texts[4].strip() if len(texts) > 4 else "",
                "country":  texts[5].strip() if len(texts) > 5 else "",
            }
            if date_str[:10] in detection["date"]:
                detections.append(detection)

    return detections


def normalize_row(row: dict) -> dict:
    """Normaliza nombres de columnas de distintas versiones del CSV de Tunesat."""
    mappings = {
        "date":     ["Date", "Fecha", "Detection Date", "date"],
        "time":     ["Time", "Hora", "Detection Time", "time"],
        "channel":  ["Channel", "Canal", "Network", "channel"],
        "title":    ["Title", "Título", "Track", "Song", "title"],
        "duration": ["Duration", "Duración", "Length", "duration"],
        "country":  ["Country", "País", "Territory", "country"],
    }
    normalized = {}
    for key, candidates in mappings.items():
        for c in candidates:
            if c in row:
                normalized[key] = row[c]
                break
        else:
            normalized[key] = ""
    return normalized


# ── Guardar resultados ───────────────────────────────────────────────────────
def save_results(results: list, date_str: str):
    out_path = DATA_DIR / f"detections_{date_str}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"✅ Resultados guardados en {out_path}")
    return out_path


def load_previous_results(date_str: str) -> list:
    yesterday = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    prev_path = DATA_DIR / f"detections_{yesterday}.json"
    if prev_path.exists():
        with open(prev_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


# ── Comparación con el día anterior ─────────────────────────────────────────
def print_changes_summary(results: list, prev_results: list):
    """
    Compara los resultados de hoy con los de ayer y muestra
    qué cuentas tuvieron cambios (nuevas detecciones).
    """
    # Indexar ayer por nombre de cuenta
    prev_by_account = {r["account"]: r for r in prev_results}

    changed   = []
    unchanged = []
    new_accounts = []

    for r in results:
        name = r["account"]
        count_today = len(r["detections"])

        if name not in prev_by_account:
            new_accounts.append((name, count_today))
            continue

        count_yesterday = len(prev_by_account[name]["detections"])
        delta = count_today - count_yesterday

        if delta != 0:
            changed.append((name, count_today, count_yesterday, delta))
        else:
            unchanged.append((name, count_today))

    print("\n" + "═" * 52)
    print("  📈 CAMBIOS RESPECTO A AYER")
    print("═" * 52)

    if changed:
        for name, today, yesterday, delta in sorted(changed, key=lambda x: -abs(x[3])):
            arrow = "▲" if delta > 0 else "▼"
            sign  = "+" if delta > 0 else ""
            print(f"  {arrow} {name:<20} {yesterday:>4} → {today:>4}  ({sign}{delta})")
    else:
        print("  Sin cambios en ninguna cuenta.")

    if new_accounts:
        print("\n  🆕 Cuentas nuevas (sin datos de ayer):")
        for name, count in new_accounts:
            print(f"     {name}: {count} detecciones")

    if unchanged:
        names = ", ".join(n for n, _ in unchanged)
        print(f"\n  ─ Sin cambios: {names}")

    print("═" * 52)

    return {
        "changed":      changed,
        "unchanged":    unchanged,
        "new_accounts": new_accounts,
    }


# ── Main ─────────────────────────────────────────────────────────────────────
async def main():
    date_str = datetime.now().strftime("%Y-%m-%d")
    accounts = get_accounts()

    if not accounts:
        print("❌ No se encontraron cuentas en las variables de entorno.")
        return

    print(f"🎵 Tunesat Agent – {date_str}")
    print(f"📋 Procesando {len(accounts)} cuentas...\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        tasks = [scrape_account(browser, acc, date_str) for acc in accounts]
        results = await asyncio.gather(*tasks)
        await browser.close()

    results = list(results)

    # Guardar JSON del día
    save_results(results, date_str)

    # Resumen por consola
    total = sum(len(r["detections"]) for r in results)
    print(f"\n📊 Total detecciones hoy: {total}")
    for r in results:
        if r["error"]:
            print(f"  ❌ {r['account']}: {r['error']}")
        else:
            print(f"  ✅ {r['account']}: {len(r['detections'])} detecciones")

    # Comparar con ayer
    prev_results = load_previous_results(date_str)
    if prev_results:
        print_changes_summary(results, prev_results)
    else:
        print("\n⚠️  Sin datos de ayer — el delta aparecerá desde mañana.")

    return results


if __name__ == "__main__":
    asyncio.run(main())
