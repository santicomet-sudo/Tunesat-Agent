// src/index.js
// Punto de entrada: carga .env, ejecuta scraper y genera reporte

import 'dotenv/config';
import { runScraper, getTodayStr } from './scraper.js';
import { runReporter, saveJSON }   from './reporter.js';

const isTest = process.argv.includes('--test');

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🎵  TUNESAT AGENT — Santi Comet        ║');
  console.log(`║   📅  ${getTodayStr()}                       ║`);
  console.log('╚══════════════════════════════════════════╝\n');

  try {
    // 1. Scraping
    const todayData = await runScraper();
    saveJSON(todayData, getTodayStr());

    // 2. Reporte
    const { htmlPath, total } = await runReporter(todayData, getTodayStr());

    console.log('\n╔══════════════════════════════════════════╗');
    console.log(`║  ✅  Completado · ${total} detecciones hoy  `);
    console.log(`║  📄  ${htmlPath}`);
    console.log('╚══════════════════════════════════════════╝');

    // Abrir el HTML en el navegador automáticamente (solo en Mac local)
    if (!process.env.CI) {
      const { exec } = await import('child_process');
      exec(`open "${htmlPath}"`);
      console.log('\n🌐 Abriendo reporte en el navegador...');
    }

  } catch (err) {
    console.error('\n❌ Error fatal:', err.message);
    process.exit(1);
  }
}

main();
