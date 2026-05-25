#!/bin/bash

# ================================================
# Actualizar archivos del Tunesat Agent en HD3
# ================================================

PROJECT="/Volumes/HD3/tunesat-agent"
DOWNLOADS="$HOME/Downloads"

echo "================================================"
echo "  Tunesat Agent – Actualizando archivos"
echo "================================================"

# Verificar que el proyecto existe
if [ ! -d "$PROJECT" ]; then
  echo "❌ No se encuentra la carpeta del proyecto en $PROJECT"
  echo "   Verifica que HD3 está conectado."
  exit 1
fi

echo "✅ Proyecto encontrado en $PROJECT"
echo ""

# Copiar tunesat_scraper.py
if [ -f "$DOWNLOADS/tunesat_scraper.py" ]; then
  cp "$DOWNLOADS/tunesat_scraper.py" "$PROJECT/scripts/tunesat_scraper.py"
  echo "✅ tunesat_scraper.py → scripts/"
else
  echo "⚠️  tunesat_scraper.py no encontrado en ~/Downloads — cópialo manualmente"
fi

# Copiar _env.example → .env.example
if [ -f "$DOWNLOADS/_env.example" ]; then
  cp "$DOWNLOADS/_env.example" "$PROJECT/.env.example"
  echo "✅ _env.example → .env.example (raíz)"
else
  echo "⚠️  _env.example no encontrado en ~/Downloads — cópialo manualmente"
fi

# Copiar README.md
if [ -f "$DOWNLOADS/README.md" ]; then
  cp "$DOWNLOADS/README.md" "$PROJECT/README.md"
  echo "✅ README.md → raíz del proyecto"
else
  echo "⚠️  README.md no encontrado en ~/Downloads — cópialo manualmente"
fi

echo ""
echo "================================================"
echo "  ✅ Hecho. Archivos actualizados en:"
echo "  $PROJECT"
echo "================================================"
echo ""
echo "⚠️  Recuerda actualizar también los Secrets de GitHub:"
echo "   - Añadir: TUNESAT_USER_9 = nelkokotcha"
echo "   - Añadir: TUNESAT_PASS_9 = Coco1284FYF"
echo "   - Editar: ACCOUNT_NAMES  (añadir ,Nelko al final)"
