#!/bin/bash
# Generate all Acepe icons from a single source
# Colors: #f5d0b0 (light peach), #e8956a (medium orange), #f57c25 (dark orange)
# Background: #1e1e2e (dark navy)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$DESKTOP_DIR/src-tauri/icons"
STATIC_DIR="$DESKTOP_DIR/static"
ASSETS_DIR="$(dirname "$(dirname "$DESKTOP_DIR")")/assets"
SOURCE_LOGO="$ASSETS_DIR/logo.svg"
SOURCE_LOGO_DARK="$ASSETS_DIR/logo-dark.svg"

echo "Generating Acepe icons..."

if [ ! -f "$SOURCE_LOGO" ]; then
  echo "Missing source logo: $SOURCE_LOGO" >&2
  exit 1
fi

# Create the master icon directly from the shared logo asset so future icon rebuilds stay in sync.
magick "$SOURCE_LOGO" -background none -resize 1024x1024 -define png:color-type=6 /tmp/acepe_icon_master.png

echo "✓ Created master icon from shared logo asset"

# Generate all Tauri icons using the CLI
cd "$DESKTOP_DIR"
bunx tauri icon /tmp/acepe_icon_master.png
echo "✓ Generated Tauri icons (icns, ico, pngs)"

# Generate favicon (32x32 with dark background)
magick /tmp/acepe_icon_master.png -resize 32x32 \
  -define png:color-type=6 \
  "$STATIC_DIR/favicon.png"
echo "✓ Generated favicon.png"

cp "$SOURCE_LOGO" "$SOURCE_LOGO_DARK"
echo "✓ Synced logo-dark.svg"

# --- Website icons ---
WEBSITE_DIR="$(dirname "$DESKTOP_DIR")/website"
WEBSITE_STATIC="$WEBSITE_DIR/static"
WEBSITE_ASSETS="$WEBSITE_DIR/src/lib/assets"

if [ -d "$WEBSITE_DIR" ]; then
  echo "Generating website icons..."

  mkdir -p "$WEBSITE_ASSETS"
  cp "$SOURCE_LOGO" "$WEBSITE_STATIC/favicon.svg"
  cp "$SOURCE_LOGO" "$WEBSITE_ASSETS/favicon.svg"
  cp "$SOURCE_LOGO" "$WEBSITE_ASSETS/logo.svg"

  # Website favicon PNGs (with dark background for better visibility)
  magick /tmp/acepe_icon_master.png -resize 16x16 -define png:color-type=6 "$WEBSITE_STATIC/favicon-16x16.png"
  magick /tmp/acepe_icon_master.png -resize 32x32 -define png:color-type=6 "$WEBSITE_STATIC/favicon-32x32.png"
  magick /tmp/acepe_icon_master.png -resize 192x192 -define png:color-type=6 "$WEBSITE_STATIC/favicon-192x192.png"
  magick /tmp/acepe_icon_master.png -resize 512x512 -define png:color-type=6 "$WEBSITE_STATIC/favicon-512x512.png"
  magick /tmp/acepe_icon_master.png -resize 180x180 -define png:color-type=6 "$WEBSITE_STATIC/apple-touch-icon.png"

  echo "✓ Generated website icons"
fi

echo ""
echo "All icons generated successfully!"
echo "Master icon saved to: /tmp/acepe_icon_master.png"
