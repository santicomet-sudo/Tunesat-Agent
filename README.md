# 🎵 Tunesat Daily Agent — Santi Comet

Agente que cada día a las **8:00h (hora Madrid)** hace login en tus 8 cuentas de Tunesat,
recoge las detecciones nuevas, y te manda un email con un resumen generado por Claude.

---

## 📁 Estructura del proyecto

```
tunesat-agent/
├── .github/workflows/
│   └── tunesat_daily.yml     ← Automatización en GitHub Actions
├── scripts/
│   ├── run_agent.py          ← Punto de entrada principal
│   ├── tunesat_scraper.py    ← Scraping de las 8 cuentas con Playwright
│   └── report_generator.py  ← Genera HTML + Excel y envía email
├── data/                     ← JSONs diarios (ignorados por git)
├── reports/                  ← HTMLs de reportes (ignorados por git)
├── requirements.txt
├── .env.example              ← Plantilla de variables de entorno
└── .gitignore
```

---

## 🚀 Configuración paso a paso

### 1. Crear el repositorio en GitHub

1. Ve a **github.com → New repository**
2. Nombre: `tunesat-agent` (puede ser privado ✅)
3. Sube todos estos archivos al repo

### 2. Configurar los Secrets de GitHub

En tu repo: **Settings → Secrets and variables → Actions → New repository secret**

Añade estos secrets uno a uno:

| Secret | Valor |
|--------|-------|
| `TUNESAT_USER_1` | email de la cuenta Santi |
| `TUNESAT_PASS_1` | contraseña de Santi |
| `TUNESAT_USER_2` | email de Fision |
| `TUNESAT_PASS_2` | contraseña de Fision |
| `TUNESAT_USER_3` | email de Perico |
| `TUNESAT_PASS_3` | contraseña de Perico |
| `TUNESAT_USER_4` | email de Cantina |
| `TUNESAT_PASS_4` | contraseña de Cantina |
| `TUNESAT_USER_5` | email de Marta |
| `TUNESAT_PASS_5` | contraseña de Marta |
| `TUNESAT_USER_6` | email de SantiSaez |
| `TUNESAT_PASS_6` | contraseña de SantiSaez |
| `TUNESAT_USER_7` | email de Cometronix |
| `TUNESAT_PASS_7` | contraseña de Cometronix |
| `TUNESAT_USER_8` | email de Aúpa Helsinki |
| `TUNESAT_PASS_8` | contraseña de Aúpa Helsinki |
| `ACCOUNT_NAMES` | `Santi,Fision,Perico,Cantina,Marta,SantiSaez,Cometronix,Aúpa Helsinki` |
| `REPORT_EMAIL` | `santicomet@gmail.com` |
| `GMAIL_SENDER` | `santicomet@gmail.com` |
| `GMAIL_APP_PASSWORD` | (ver paso 3) |
| `ANTHROPIC_API_KEY` | tu clave de Anthropic |

### 3. Obtener Gmail App Password

Para que el agente pueda enviarte emails desde Gmail sin usar tu contraseña real:

1. Ve a **myaccount.google.com → Seguridad**
2. Activa la **verificación en dos pasos** (si no la tienes)
3. Ve a **Contraseñas de aplicaciones**
4. Crea una nueva con nombre "Tunesat Agent"
5. Copia los 16 caracteres que te da → úsalos como `GMAIL_APP_PASSWORD`

### 4. Ejecutar manualmente (primera prueba)

En tu repo de GitHub:
- Ve a **Actions → Tunesat Daily Report**
- Haz clic en **Run workflow** → **Run workflow**

Verás los logs en tiempo real. Si todo va bien, recibirás el email en unos minutos.

---

## 📧 Qué contiene el email

- **Resumen en español generado por Claude** con las novedades del día
- **KPIs**: total detecciones hoy, cambio vs ayer, cuentas monitorizadas
- **Tabla resumen** por cuenta con delta respecto al día anterior
- **Detalle** de cada detección (canal, canción, duración, país, hora)
- **Excel adjunto** con el histórico acumulado de todos los días

---

## 🔧 Ajustes de horario

El agente corre a las 8:00h Madrid. Si quieres cambiarlo, edita las líneas `cron` en
`.github/workflows/tunesat_daily.yml`:

- **Horario verano** (CEST = UTC+2): `0 6 * * *`
- **Horario invierno** (CET = UTC+1): `0 7 * * *`

---

## 💡 Notas importantes

- Las credenciales **nunca** se guardan en el código, solo en Secrets de GitHub (cifrados)
- Los datos JSON del día se cachean entre ejecuciones para poder comparar con el día anterior
- Si Tunesat cambia su web y el scraper falla, el email incluirá el error para cada cuenta
- El Excel histórico se acumula día a día vía la caché de GitHub Actions

---

## 🆘 Solución de problemas

| Problema | Solución |
|----------|----------|
| Login fallido en alguna cuenta | Verifica el secret `TUNESAT_USER_X` / `TUNESAT_PASS_X` |
| Email no llega | Comprueba `GMAIL_APP_PASSWORD` (no es tu contraseña normal) |
| Error de Playwright | El workflow reinstala Chromium automáticamente |
| Sin datos de ayer | Normal el primer día; el delta aparecerá desde el segundo día |
