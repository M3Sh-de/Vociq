#!/bin/bash
cd "$(dirname "$0")/server"
if [ ! -d node_modules ]; then
  echo "Pakete werden installiert..."
  npm install
fi
echo "Voice Dashboard Server startet auf Port ${PORT:-3000}..."
node server.js
