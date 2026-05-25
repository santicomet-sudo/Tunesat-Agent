"""
run_agent.py
Punto de entrada único. Ejecuta:
  1. tunesat_scraper.py  → recoge detecciones de las 8 cuentas
  2. report_generator.py → genera HTML + Excel y envía email
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tunesat_scraper import main as scrape
from report_generator import main as report


async def run():
    print("=" * 50)
    print("  TUNESAT AGENT - Iniciando ciclo diario")
    print("=" * 50)

    # Paso 1: Scraping
    print("\n🕷️  PASO 1: Scraping de Tunesat...\n")
    await scrape()

    # Paso 2: Reporte
    print("\n📧  PASO 2: Generando y enviando reporte...\n")
    report()

    print("\n" + "=" * 50)
    print("  ✅ Ciclo completado correctamente")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(run())
