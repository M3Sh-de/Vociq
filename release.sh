#!/bin/bash
# ── Release-Skript: packt server.tar.gz für GitHub Release ────────────────────
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$1" ]; then
  echo "Verwendung: ./release.sh v1.0.1"
  exit 1
fi
VERSION="$1"

echo -e "${YELLOW}Erstelle Release $VERSION...${NC}"

# Packe Server-Dateien
echo "  → server.tar.gz"
tar -czf "$SCRIPT_DIR/server.tar.gz" \
  -C "$SCRIPT_DIR/server" \
  server.js package.json

echo -e "${GREEN}✅ server.tar.gz erstellt.${NC}"
echo ""
echo "Nächste Schritte:"
echo "  1. git add . && git commit -m 'Release $VERSION'"
echo "  2. git tag $VERSION && git push origin $VERSION"
echo "  3. Auf GitHub: Releases → New release → Tag $VERSION"
echo "     → server.tar.gz hochladen"
echo "     → Für Client: npm run publish (mit GH_TOKEN)"
echo ""
