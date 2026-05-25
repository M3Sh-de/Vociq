#!/bin/bash
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

# ── Config ─────────────────────────────────────────────────────────────────────
GITHUB_REPO="M3Sh-de/voice-dashboard"   # <── anpassen
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$INSTALL_DIR/.backups"
SERVICE_NAME="voice-dashboard"

echo ""
echo -e "${GREEN}=========================================="
echo " Voice Dashboard - Server Update"
echo -e "==========================================${NC}"

# ── Get latest release info ────────────────────────────────────────────────────
echo -e "\n${YELLOW}Prüfe auf neue Version...${NC}"

API_URL="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
RELEASE_JSON=$(curl -sf "$API_URL" 2>/dev/null || echo "")

if [ -z "$RELEASE_JSON" ]; then
  echo -e "${RED}[FEHLER] GitHub nicht erreichbar oder Repo nicht gefunden.${NC}"
  echo "  Repo: $GITHUB_REPO"
  echo "  Bitte in update.sh die Variable GITHUB_REPO anpassen."
  exit 1
fi

LATEST_VERSION=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tag_name'])" 2>/dev/null || \
                 echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d'"' -f4)

DOWNLOAD_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    if a['name']=='server.tar.gz':
        print(a['browser_download_url'])
        break
" 2>/dev/null || echo "")

# Current version
CURRENT_VERSION="unbekannt"
if [ -f "$INSTALL_DIR/VERSION" ]; then
  CURRENT_VERSION=$(cat "$INSTALL_DIR/VERSION")
fi

echo -e "  Aktuelle Version : ${YELLOW}${CURRENT_VERSION}${NC}"
echo -e "  Neueste Version  : ${GREEN}${LATEST_VERSION}${NC}"

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ] && [ "$1" != "--force" ]; then
  echo -e "\n${GREEN}✅ Server ist bereits aktuell.${NC}"
  echo "  (Mit --force erzwingen)"
  exit 0
fi

if [ -z "$DOWNLOAD_URL" ]; then
  echo -e "${RED}[FEHLER] Kein server.tar.gz Release-Asset auf GitHub gefunden.${NC}"
  echo "  Stelle sicher, dass dein GitHub Release ein 'server.tar.gz' enthält."
  exit 1
fi

# ── Backup ─────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}Erstelle Backup...${NC}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/server-${CURRENT_VERSION}-$(date +%Y%m%d%H%M%S).tar.gz"
tar -czf "$BACKUP_FILE" -C "$INSTALL_DIR/server" . 2>/dev/null || true
echo -e "  Backup: $BACKUP_FILE"

# ── Download ───────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}Lade server.tar.gz herunter...${NC}"
TMP_FILE="/tmp/vd-server-update.tar.gz"
curl -L --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE"

# ── Stop service ───────────────────────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo -e "\n${YELLOW}Stoppe Dienst...${NC}"
  sudo systemctl stop "$SERVICE_NAME"
  SERVICE_WAS_RUNNING=true
fi

# ── Extract & install ──────────────────────────────────────────────────────────
echo -e "\n${YELLOW}Installiere neue Version...${NC}"
tar -xzf "$TMP_FILE" -C "$INSTALL_DIR/server"
rm "$TMP_FILE"

# ── Install new npm packages if needed ────────────────────────────────────────
echo -e "\n${YELLOW}Aktualisiere npm Pakete...${NC}"
cd "$INSTALL_DIR/server"
npm install --omit=dev

# ── Save version ───────────────────────────────────────────────────────────────
echo "$LATEST_VERSION" > "$INSTALL_DIR/VERSION"

# ── Restart service ────────────────────────────────────────────────────────────
if [ "$SERVICE_WAS_RUNNING" = true ]; then
  echo -e "\n${YELLOW}Starte Dienst neu...${NC}"
  sudo systemctl start "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}✅ Dienst läuft.${NC}"
  else
    echo -e "${RED}[WARNUNG] Dienst konnte nicht gestartet werden.${NC}"
    echo "  sudo journalctl -u $SERVICE_NAME -n 30"
  fi
else
  echo -e "\n${YELLOW}Server manuell starten: ./start.sh${NC}"
fi

echo ""
echo -e "${GREEN}=========================================="
echo -e " ✅ Update auf $LATEST_VERSION abgeschlossen!"
echo -e "==========================================${NC}"
echo ""
