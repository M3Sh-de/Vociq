#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}=========================================="
echo " Voice Dashboard - Server Setup"
echo -e "==========================================${NC}"
echo ""

# ── Node.js check ─────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Node.js nicht gefunden. Installiere...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_VER=$(node -v)
echo -e "${GREEN}Node.js $NODE_VER gefunden.${NC}"

# ── Build tools ───────────────────────────────────────────────────────────────
echo ""
echo "Installiere Build-Tools (für mediasoup)..."
sudo apt-get install -y build-essential python3 python3-pip git 2>/dev/null || \
  sudo yum install -y gcc-c++ make python3 git 2>/dev/null || \
  echo -e "${YELLOW}Konnte Build-Tools nicht automatisch installieren. Bitte manuell: sudo apt install build-essential python3${NC}"

# ── Server dependencies ───────────────────────────────────────────────────────
echo ""
echo "Installiere Server-Pakete..."
cd "$(dirname "$0")/server"
npm install

# ── Public IP detect ──────────────────────────────────────────────────────────
echo ""
PUBLIC_IP=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || echo "")
if [ -n "$PUBLIC_IP" ]; then
  echo -e "${GREEN}Öffentliche IP erkannt: $PUBLIC_IP${NC}"
  read -p "Diese IP in server.js eintragen? [J/n] " yn
  if [[ "$yn" != "n" && "$yn" != "N" ]]; then
    sed -i "s/announcedIp: process.env.ANNOUNCED_IP || null/announcedIp: process.env.ANNOUNCED_IP || '$PUBLIC_IP'/" server.js
    echo -e "${GREEN}IP eingetragen: $PUBLIC_IP${NC}"
  fi
else
  echo -e "${YELLOW}IP konnte nicht automatisch erkannt werden."
  read -p "Öffentliche IP manuell eingeben (oder leer lassen für lokal): " MANUAL_IP
  if [ -n "$MANUAL_IP" ]; then
    sed -i "s/announcedIp: process.env.ANNOUNCED_IP || null/announcedIp: process.env.ANNOUNCED_IP || '$MANUAL_IP'/" server.js
    echo -e "${GREEN}IP eingetragen: $MANUAL_IP${NC}"
  fi
fi

# ── Firewall ──────────────────────────────────────────────────────────────────
echo ""
echo "Öffne Firewall-Ports..."
if command -v ufw &> /dev/null; then
  sudo ufw allow 3000/tcp comment "Voice Dashboard Signaling" 2>/dev/null || true
  sudo ufw allow 40000:49999/udp comment "Voice Dashboard WebRTC" 2>/dev/null || true
  echo -e "${GREEN}UFW: Port 3000/TCP und 40000-49999/UDP geöffnet.${NC}"
elif command -v firewall-cmd &> /dev/null; then
  sudo firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
  sudo firewall-cmd --permanent --add-port=40000-49999/udp 2>/dev/null || true
  sudo firewall-cmd --reload 2>/dev/null || true
  echo -e "${GREEN}firewalld: Ports geöffnet.${NC}"
else
  echo -e "${YELLOW}Kein bekannter Firewall-Manager. Bitte manuell öffnen:"
  echo "  Port 3000 TCP (Signaling)"
  echo -e "  Port 40000-49999 UDP (WebRTC Audio)${NC}"
fi

# ── Systemd service ───────────────────────────────────────────────────────────
echo ""
read -p "Als systemd-Dienst einrichten (Autostart beim Booten)? [J/n] " yn
if [[ "$yn" != "n" && "$yn" != "N" ]]; then
  SERVER_PATH="$(pwd)/server.js"
  NODE_PATH=$(which node)
  sudo bash -c "cat > /etc/systemd/system/voice-dashboard.service << EOF
[Unit]
Description=Voice Dashboard Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$NODE_PATH $SERVER_PATH
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF"
  sudo systemctl daemon-reload
  sudo systemctl enable voice-dashboard
  sudo systemctl start voice-dashboard
  echo -e "${GREEN}Dienst eingerichtet und gestartet!${NC}"
  echo ""
  echo "Nützliche Befehle:"
  echo "  sudo systemctl status voice-dashboard   → Status anzeigen"
  echo "  sudo systemctl restart voice-dashboard  → Neustart"
  echo "  sudo journalctl -u voice-dashboard -f   → Logs live"
else
  echo ""
  echo -e "${GREEN}Setup abgeschlossen. Server starten mit:${NC}"
  echo "  cd server && node server.js"
  echo "  oder: ./start.sh"
fi

echo ""
echo -e "${GREEN}=========================================="
echo " Server läuft auf Port 3000"
echo -e "==========================================${NC}"
echo ""
