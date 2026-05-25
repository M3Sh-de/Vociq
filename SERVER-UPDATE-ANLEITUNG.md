# Vociq – Server manuell updaten (ohne GitHub)

## Methode 1 — Dateien direkt per SFTP hochladen (empfohlen)

### Tools die du brauchst
- **WinSCP** (kostenlos): https://winscp.net
- oder **FileZilla**: https://filezilla-project.org

### Schritt für Schritt

1. **WinSCP öffnen**
   - Protokoll: SFTP
   - Server: deine Server-IP
   - Port: 22
   - Benutzername + Passwort eingeben
   - → Verbinden

2. **Auf dem Server navigieren**
   - Rechte Seite (Server): in den Vociq-Ordner navigieren
   - z.B. `/home/ubuntu/vociq/server/`

3. **Geänderte Dateien hochladen**
   - Nur die geänderten Dateien rüberziehen:
     - `server.js` → bei Server-Änderungen
     - `servers.json` wird nicht überschrieben (enthält deine Daten!)

4. **Server neu starten**
   - PuTTY oder Terminal öffnen und eintippen:
   ```
   sudo systemctl restart vociq
   ```
   - Oder ohne systemd:
   ```
   pkill -f "node server.js" && cd ~/vociq && ./start.sh &
   ```

---

## Methode 2 — Per SSH direkt auf dem Server

```bash
# 1. Verbinde dich per SSH
ssh ubuntu@DEINE-SERVER-IP

# 2. Navigiere in den Vociq-Ordner
cd ~/vociq

# 3. Lade die neue server.js herunter
# (z.B. von deiner eigenen Webseite oder einem Fileserver)
wget https://DEINE-URL/server.js -O server/server.js

# 4. Abhängigkeiten updaten falls nötig
cd server && npm install

# 5. Neustart
sudo systemctl restart vociq

# 6. Status prüfen
sudo systemctl status vociq
```

---

## Methode 3 — Update-Skript mit eigenem Webserver

Wenn du einen eigenen Webserver oder Webspace hast (z.B. Hetzner, Strato, IONOS):

1. Neue `server.js` auf deinen Webspace hochladen
2. Auf dem Vociq-Server eintippen:
```bash
cd ~/vociq
wget https://deine-domain.de/vociq/server.js -O server/server.js
sudo systemctl restart vociq
```

---

## Client (.exe) updaten

Die neue `.exe` einfach an alle Nutzer schicken
(z.B. per Discord, WhatsApp, eigene Webseite).

Nutzer deinstallieren die alte Version und installieren die neue.

---

## Schnell-Befehle für den Server

| Was | Befehl |
|-----|--------|
| Status prüfen | `sudo systemctl status vociq` |
| Neu starten | `sudo systemctl restart vociq` |
| Stoppen | `sudo systemctl stop vociq` |
| Starten | `sudo systemctl start vociq` |
| Live-Logs | `sudo journalctl -u vociq -f` |
| Wer ist verbunden? | `curl localhost:3000/health` |
