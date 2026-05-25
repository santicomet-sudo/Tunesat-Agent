// src/reporter.js
// Genera el reporte HTML, actualiza el Excel y envía el email

import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import Anthropic from '@anthropic-ai/sdk';

const DATA_DIR    = './data';
const REPORTS_DIR = './reports';
[DATA_DIR, REPORTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadJSON(dateStr) {
  const p = path.join(DATA_DIR, `detections_${dateStr}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : [];
}

function saveJSON(data, dateStr) {
  const p = path.join(DATA_DIR, `detections_${dateStr}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`💾 Datos guardados: ${p}`);
}

function allDetections(today) {
  return today.flatMap(r => r.detections.map(d => ({ ...d, _slot: r.account })));
}

function topN(arr, key, n = 5) {
  const counts = {};
  arr.forEach(d => { const v = d[key] || 'Desconocido'; counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, n);
}

function yesterday(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Resumen con Claude ────────────────────────────────────────────────────────
async function generateAISummary(allDet, totalYesterday) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith('sk-ant-...')) {
    return 'Resumen IA no disponible (configura ANTHROPIC_API_KEY en el .env).';
  }

  const client = new Anthropic({ apiKey });
  const delta  = allDet.length - totalYesterday;
  const context = {
    fecha: new Date().toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' }),
    total_hoy: allDet.length,
    total_ayer: totalYesterday,
    cambio: delta,
    canales_top: topN(allDet, 'channel').map(([c,n]) => `${c} (${n})`).join(', '),
    canciones_top: topN(allDet, 'title').map(([t,n]) => `${t} (${n}x)`).join(', '),
    paises: [...new Set(allDet.map(d => d.country).filter(Boolean))].join(', '),
  };

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 350,
    messages: [{
      role: 'user',
      content: `Eres el asistente de Santi Comet, músico español. 
Las 8 cuentas de Tunesat son particiones técnicas del mismo catálogo (límite 50 canciones/cuenta).
Todo es música de Santi Comet detectada en TV y medios.

Datos de hoy:
${JSON.stringify(context, null, 2)}

Escribe un resumen diario en español (tutéale), tono cercano y profesional.
Menciona: total detecciones y cambio vs ayer, canales más activos, canciones destacadas, países si hay variedad.
Máximo 150 palabras. Solo texto limpio, sin asteriscos ni markdown.`
    }]
  });
  return msg.content[0].text;
}

// ── Excel histórico ───────────────────────────────────────────────────────────
async function updateExcel(today, dateStr) {
  const excelPath = path.join(DATA_DIR, 'historico_detecciones.xlsx');
  const wb = new ExcelJS.Workbook();

  if (fs.existsSync(excelPath)) {
    await wb.xlsx.readFile(excelPath);
  }

  let ws = wb.getWorksheet('Detecciones') || wb.addWorksheet('Detecciones');

  // Cabeceras solo si es nuevo
  if (ws.rowCount === 0) {
    const headers = ['Fecha','Slot','Canal','Canción','Duración','País','Hora'];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
      cell.alignment = { horizontal: 'center' };
    });
    ws.columns = [
      { key:'date',    width:12 },
      { key:'slot',    width:14 },
      { key:'channel', width:22 },
      { key:'title',   width:32 },
      { key:'duration',width:10 },
      { key:'country', width:12 },
      { key:'time',    width:10 },
    ];
    ws.views = [{ state:'frozen', ySplit:1 }];
  }

  // Añadir filas de hoy
  const thin = { style:'thin', color:{ argb:'FFCCCCDD' } };
  const border = { top:thin, bottom:thin, left:thin, right:thin };

  for (const r of today) {
    for (const d of r.detections) {
      const row = ws.addRow([dateStr, r.account, d.channel||'', d.title||'', d.duration||'', d.country||'', d.time||'']);
      row.eachCell(cell => {
        cell.border = border;
        cell.font   = { name:'Arial', size:10 };
        cell.alignment = { horizontal:'center' };
      });
      row.getCell(4).alignment = { horizontal:'left' }; // título alineado izq
    }
  }

  await wb.xlsx.writeFile(excelPath);
  console.log(`📊 Excel actualizado: ${excelPath}`);
  return excelPath;
}

// ── HTML del email ────────────────────────────────────────────────────────────
function buildHTML(allDet, totalYesterday, aiSummary, dateStr, slotErrors) {
  const dateFmt    = new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' });
  const total      = allDet.length;
  const delta      = total - totalYesterday;
  const deltaStr   = delta >= 0 ? `+${delta}` : `${delta}`;
  const deltaColor = delta >= 0 ? '#27ae60' : '#e74c3c';

  const countries  = topN(allDet, 'country', 20);
  const geoLine    = countries.map(([c,n]) => `<span style="font-weight:600;color:#1A1A2E">${c}</span> <span style="color:#999">(${n})</span>`).join(' &nbsp;·&nbsp; ') || '<span style="color:#999">Sin datos</span>';

  // Barras de canales
  const topChannels = topN(allDet, 'channel', 6);
  const maxCh = topChannels[0]?.[1] || 1;
  const channelsHTML = topChannels.map(([ch, n]) => `
    <tr>
      <td style="padding:7px 12px;font-size:13px;color:#333;white-space:nowrap">${ch}</td>
      <td style="padding:7px 12px;width:55%">
        <div style="background:#eeeef8;border-radius:4px;height:9px">
          <div style="background:#1A1A2E;width:${Math.round(n/maxCh*100)}%;height:9px;border-radius:4px"></div>
        </div>
      </td>
      <td style="padding:7px 12px;font-weight:700;color:#1A1A2E;text-align:right;font-size:13px">${n}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="padding:10px;color:#999;font-size:13px">Sin datos de canal</td></tr>';

  // Top canciones
  const topTracks = topN(allDet, 'title', 6);
  const tracksHTML = topTracks.map(([t,n], i) => `
    <tr style="border-bottom:1px solid #f0f0f8">
      <td style="padding:8px 12px;color:#aaa;font-size:12px">#${i+1}</td>
      <td style="padding:8px 12px;color:#1A1A2E;font-weight:600;font-size:13px">${t}</td>
      <td style="padding:8px 12px;color:#666;font-size:13px;text-align:right">${n}×</td>
    </tr>`).join('') || '<tr><td colspan="3" style="padding:10px;color:#999;font-size:13px">Sin datos</td></tr>';

  // Tabla detalle
  const sorted = [...allDet].sort((a,b) => (b.time||'').localeCompare(a.time||''));
  const detailRows = sorted.slice(0, 60).map(d => `
    <tr style="border-bottom:1px solid #f5f5fb">
      <td style="padding:6px 10px;color:#888;font-size:12px">${d.time||''}</td>
      <td style="padding:6px 10px;color:#1A1A2E;font-weight:600;font-size:12px">${d.title||''}</td>
      <td style="padding:6px 10px;color:#333;font-size:12px">${d.channel||''}</td>
      <td style="padding:6px 10px;color:#666;font-size:12px;text-align:center">${d.country||''}</td>
      <td style="padding:6px 10px;color:#999;font-size:12px;text-align:center">${d.duration||''}</td>
    </tr>`).join('');
  const moreRows = allDet.length > 60 ? `<tr><td colspan="5" style="padding:10px;text-align:center;color:#aaa;font-style:italic;font-size:12px">… y ${allDet.length-60} detecciones más en el Excel adjunto</td></tr>` : '';

  // Errores de slots
  const errorsHTML = slotErrors.length ? `
    <div style="margin:0 32px 24px;background:#fff5f5;border:1px solid #fcc;border-radius:8px;padding:14px 16px">
      <p style="margin:0 0 6px;font-weight:700;color:#c0392b;font-size:13px">⚠️ Slots con incidencia</p>
      ${slotErrors.map(([s,e]) => `<p style="margin:3px 0;font-size:12px;color:#666"><b>${s}:</b> ${e}</p>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f8;font-family:Arial,sans-serif">
<div style="max-width:660px;margin:30px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">

  <div style="background:linear-gradient(135deg,#1A1A2E,#2d2d5e);padding:34px 32px;text-align:center">
    <div style="font-size:34px;margin-bottom:10px">🎵</div>
    <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:2px;font-weight:700">SANTI COMET</h1>
    <p style="color:#8899cc;margin:6px 0 0;font-size:12px;letter-spacing:2px">TUNESAT DAILY REPORT · ${dateFmt.toUpperCase()}</p>
  </div>

  <div style="background:#f8f9ff;padding:22px 32px;border-bottom:2px solid #eeeef8">
    <p style="margin:0;color:#333;line-height:1.8;font-size:14px">${aiSummary}</p>
  </div>

  <div style="padding:24px 32px 12px;display:flex;gap:14px">
    <div style="flex:1;background:#1A1A2E;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:38px;font-weight:700;color:#fff">${total}</div>
      <div style="font-size:11px;color:#8899cc;margin-top:5px;letter-spacing:1px">DETECCIONES HOY</div>
    </div>
    <div style="flex:1;background:#f0f0f8;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:38px;font-weight:700;color:${deltaColor}">${deltaStr}</div>
      <div style="font-size:11px;color:#888;margin-top:5px;letter-spacing:1px">VS AYER (${totalYesterday})</div>
    </div>
    <div style="flex:1;background:#f0f0f8;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:38px;font-weight:700;color:#1A1A2E">${countries.length}</div>
      <div style="font-size:11px;color:#888;margin-top:5px;letter-spacing:1px">PAÍSES</div>
    </div>
  </div>

  <div style="padding:8px 32px 16px">
    <p style="margin:0;font-size:12px;color:#888;line-height:1.8">📍 ${geoLine}</p>
  </div>

  <div style="padding:4px 32px 20px">
    <h2 style="font-size:13px;color:#1A1A2E;margin:0 0 10px;text-transform:uppercase;letter-spacing:1.5px">📺 Canales más activos</h2>
    <table width="100%" cellpadding="0" cellspacing="0">${channelsHTML}</table>
  </div>

  <div style="padding:4px 32px 20px">
    <h2 style="font-size:13px;color:#1A1A2E;margin:0 0 10px;text-transform:uppercase;letter-spacing:1.5px">🎼 Canciones más emitidas</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${tracksHTML}</table>
  </div>

  <div style="padding:4px 32px 28px">
    <h2 style="font-size:13px;color:#1A1A2E;margin:0 0 10px;text-transform:uppercase;letter-spacing:1.5px">📋 Todas las detecciones</h2>
    ${total > 0 ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#1A1A2E">
        <th style="padding:8px 10px;color:#8899cc;font-size:11px;font-weight:500;text-align:left">HORA</th>
        <th style="padding:8px 10px;color:#8899cc;font-size:11px;font-weight:500;text-align:left">CANCIÓN</th>
        <th style="padding:8px 10px;color:#8899cc;font-size:11px;font-weight:500;text-align:left">CANAL</th>
        <th style="padding:8px 10px;color:#8899cc;font-size:11px;font-weight:500;text-align:center">PAÍS</th>
        <th style="padding:8px 10px;color:#8899cc;font-size:11px;font-weight:500;text-align:center">DUR.</th>
      </tr>
      ${detailRows}${moreRows}
    </table>` : '<p style="color:#aaa;font-size:13px">Sin detecciones nuevas hoy.</p>'}
  </div>

  ${errorsHTML}

  <div style="background:#1A1A2E;padding:18px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#556699">
      Tunesat Agent · Santi Comet © ${new Date().getFullYear()} · 400 canciones · 8 slots monitorizados
    </p>
  </div>
</div>
</body></html>`;
}

// ── Envío de email ────────────────────────────────────────────────────────────
async function sendEmail(html, excelPath, dateStr) {
  const sender  = process.env.GMAIL_SENDER;
  const appPwd  = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g,'');
  const to      = process.env.REPORT_EMAIL;

  if (!appPwd || appPwd === 'xxxxxxxxxxxxxxxx') {
    console.log('📧 Email no enviado (GMAIL_APP_PASSWORD no configurado)');
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: sender, pass: appPwd }
  });

  await transporter.sendMail({
    from:    `"Tunesat Agent 🎵" <${sender}>`,
    to,
    subject: `🎵 Tunesat Report · ${dateStr}`,
    html,
    attachments: fs.existsSync(excelPath) ? [{
      filename: `Tunesat_Historico_${dateStr}.xlsx`,
      path: excelPath
    }] : []
  });

  console.log(`✉️  Email enviado a ${to}`);
  return true;
}

// ── Main del reporter ─────────────────────────────────────────────────────────
export async function runReporter(todayData, dateStr) {
  const yday      = yesterday(dateStr);
  const prevData  = loadJSON(yday);
  const allDet    = allDetections(todayData);
  const totalYday = allDetections(prevData).length;
  const slotErrors= todayData.filter(r => r.error).map(r => [r.account, r.error]);

  console.log(`\n📊 Generando reporte (${allDet.length} detecciones hoy, ${totalYday} ayer)...`);

  const [aiSummary, excelPath] = await Promise.all([
    generateAISummary(allDet, totalYday),
    updateExcel(todayData, dateStr)
  ]);

  const html = buildHTML(allDet, totalYday, aiSummary, dateStr, slotErrors);

  // Guardar HTML
  const htmlPath = path.join(REPORTS_DIR, `report_${dateStr}.html`);
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`🌐 Reporte HTML: ${htmlPath}`);

  // Enviar email
  await sendEmail(html, excelPath, dateStr);

  return { html, htmlPath, excelPath, total: allDet.length };
}

export { saveJSON, loadJSON };
