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

# Colors
BG_COLOR="#1e1e2e"
BAR1_COLOR="#f5d0b0"
BAR2_COLOR="#e8956a"
BAR3_COLOR="#f57c25"

echo "Generating Acepe icons..."

# Create master 1024x1024 icon with padding (~10% on each side)
# Icon shape: 824x824 centered in 1024x1024
# Corner radius: ~22% of icon size = 181px
magick -size 1024x1024 xc:none \
  -fill "$BG_COLOR" \
  -draw "roundrectangle 100,100 923,923 181,181" \
  \( -size 112x352 xc:none -fill "$BAR1_COLOR" -draw "roundrectangle 0,0 111,351 28,28" \) \
  -geometry +310+336 -composite \
  \( -size 112x352 xc:none -fill "$BAR2_COLOR" -draw "roundrectangle 0,0 111,351 28,28" \) \
  -geometry +456+336 -composite \
  \( -size 112x352 xc:none -fill "$BAR3_COLOR" -draw "roundrectangle 0,0 111,351 28,28" \) \
  -geometry +602+336 -composite \
  -define png:color-type=6 \
  /tmp/acepe_icon_master.png

echo "✓ Created master icon"

# Generate all Tauri icons using the CLI
cd "$DESKTOP_DIR"
bunx tauri icon /tmp/acepe_icon_master.png
echo "✓ Generated Tauri icons (icns, ico, pngs)"

# Generate favicon (32x32 with dark background)
magick /tmp/acepe_icon_master.png -resize 32x32 \
  -define png:color-type=6 \
  "$STATIC_DIR/favicon.png"
echo "✓ Generated favicon.png"

# Generate SVG logo (transparent background, for in-app use)
cat > "$ASSETS_DIR/logo.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <!-- Acepe Logo - Three bars, peach to orange gradient -->
  <rect x="5" y="5" width="6" height="22" rx="2" fill="#f5d0b0"/>
  <rect x="13" y="5" width="6" height="22" rx="2" fill="#e8956a"/>
  <rect x="21" y="5" width="6" height="22" rx="2" fill="#f57c25"/>
</svg>
EOF
echo "✓ Generated logo.svg (transparent)"

# Generate SVG logo with dark background (for external use)
cat > "$ASSETS_DIR/logo-dark.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <!-- Acepe Logo - Dark background variant -->
  <rect width="32" height="32" rx="7" fill="#1e1e2e"/>
  <rect x="7" y="7" width="5" height="18" rx="1.5" fill="#f5d0b0"/>
  <rect x="13.5" y="7" width="5" height="18" rx="1.5" fill="#e8956a"/>
  <rect x="20" y="7" width="5" height="18" rx="1.5" fill="#f57c25"/>
</svg>
EOF
echo "✓ Generated logo-dark.svg"

# --- Website icons ---
WEBSITE_DIR="$(dirname "$DESKTOP_DIR")/website"
WEBSITE_STATIC="$WEBSITE_DIR/static"
WEBSITE_ASSETS="$WEBSITE_DIR/src/lib/assets"

if [ -d "$WEBSITE_DIR" ]; then
  echo "Generating website icons..."

  # Website favicon SVG (transparent, for light/dark backgrounds)
  cat > "$WEBSITE_STATIC/favicon.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <rect x="5" y="5" width="6" height="22" rx="2" fill="#f5d0b0"/>
  <rect x="13" y="5" width="6" height="22" rx="2" fill="#e8956a"/>
  <rect x="21" y="5" width="6" height="22" rx="2" fill="#f57c25"/>
</svg>
EOF

  # Website lib assets favicon.svg (same as static)
  mkdir -p "$WEBSITE_ASSETS"
  cp "$WEBSITE_STATIC/favicon.svg" "$WEBSITE_ASSETS/favicon.svg"

  # Website lib assets logo.svg
  cat > "$WEBSITE_ASSETS/logo.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <rect x="5" y="5" width="6" height="22" rx="2" fill="#f5d0b0"/>
  <rect x="13" y="5" width="6" height="22" rx="2" fill="#e8956a"/>
  <rect x="21" y="5" width="6" height="22" rx="2" fill="#f57c25"/>
</svg>
EOF

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
