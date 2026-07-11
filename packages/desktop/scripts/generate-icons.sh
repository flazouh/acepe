#!/bin/bash
# Generate all Acepe icons from the canonical source logo.
# The app icon uses the light geometric mark on Acepe's #121212 background.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$DESKTOP_DIR/src-tauri/icons"
STATIC_DIR="$DESKTOP_DIR/static"
ASSETS_DIR="$(dirname "$(dirname "$DESKTOP_DIR")")/assets"
CANONICAL_LOGO="$ASSETS_DIR/logo.svg"
LOGO_SOURCE_BACKGROUND="#121212"
MASTER_ICON_PNG="/tmp/acepe_icon_master.png"

echo "Generating Acepe icons..."

if [ ! -f "$CANONICAL_LOGO" ]; then
  echo "Missing canonical logo: $CANONICAL_LOGO" >&2
  exit 1
fi

# Create a square master icon with generous breathing room around the mark.
magick -background none -density 1024 "$CANONICAL_LOGO" \
  -resize 660x451 \
  -background "$LOGO_SOURCE_BACKGROUND" \
  -gravity center \
  -extent 1024x1024 \
  -define png:color-type=6 \
  "$MASTER_ICON_PNG"

echo "✓ Created master icon from canonical light logo"

# Generate all Tauri icons using the CLI
cd "$DESKTOP_DIR"
bunx tauri icon "$MASTER_ICON_PNG"
echo "✓ Generated Tauri icons (icns, ico, pngs)"

# Generate favicon (32x32 with dark background)
magick "$MASTER_ICON_PNG" -resize 32x32 \
  -define png:color-type=6 \
  "$STATIC_DIR/favicon.png"
echo "✓ Generated favicon.png"

# --- Website icons ---
WEBSITE_DIR="$(dirname "$DESKTOP_DIR")/website"
WEBSITE_STATIC="$WEBSITE_DIR/static"

if [ -d "$WEBSITE_DIR" ]; then
  echo "Generating website icons..."

  cp "$CANONICAL_LOGO" "$WEBSITE_STATIC/favicon.svg"

  # Website favicon PNGs
  magick "$MASTER_ICON_PNG" -resize 16x16 -define png:color-type=6 "$WEBSITE_STATIC/favicon-16x16.png"
  magick "$MASTER_ICON_PNG" -resize 32x32 -define png:color-type=6 "$WEBSITE_STATIC/favicon-32x32.png"
  magick "$MASTER_ICON_PNG" -resize 192x192 -define png:color-type=6 "$WEBSITE_STATIC/favicon-192x192.png"
  magick "$MASTER_ICON_PNG" -resize 512x512 -define png:color-type=6 "$WEBSITE_STATIC/favicon-512x512.png"
  magick "$MASTER_ICON_PNG" -resize 180x180 -define png:color-type=6 "$WEBSITE_STATIC/apple-touch-icon.png"

  # Favicon.ico (multi-resolution for legacy browsers)
  magick "$MASTER_ICON_PNG" -resize 48x48 -define icon:auto-resize=48,32,16 "$WEBSITE_STATIC/favicon.ico"

  # OG image (1200x630 social preview with logo centered on brand background)
  magick -size 1200x630 "xc:$LOGO_SOURCE_BACKGROUND" \
    \( "$MASTER_ICON_PNG" -resize 400x400 \) \
    -gravity center -composite \
    "$WEBSITE_STATIC/og-image.png"
  magick "$WEBSITE_STATIC/og-image.png" -quality 90 "$WEBSITE_STATIC/og-image.jpg"

  # Patch Android launcher background (bunx tauri icon resets it to #fff)
  ANDROID_BG_FILE="$ICONS_DIR/android/values/ic_launcher_background.xml"
  if [ -f "$ANDROID_BG_FILE" ]; then
    sed -i '' "s/#fff/$LOGO_SOURCE_BACKGROUND/g" "$ANDROID_BG_FILE"
    echo "✓ Patched Android launcher background to $LOGO_SOURCE_BACKGROUND"
  fi

  echo "✓ Generated website icons"
fi

echo ""
echo "All icons generated successfully!"
echo "Master icon saved to: $MASTER_ICON_PNG"
