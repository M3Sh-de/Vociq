# Voice Dashboard

---

## Einmalige GitHub-Einrichtung

### 1. GitHub Repository erstellen
- Auf github.com: "New repository" → Name: `voice-dashboard` → Public
- Repository-URL notieren: `https://github.com/DEINNAME/voice-dashboard`

### 2. Zwei Stellen anpassen

**client/package.json** — Zeile `"owner"`:
```json
"publish": {
  "provider": "github",
  "owner": "DEIN_GITHUB_USERNAME",
  "repo": "voice-dashboard"
}
```

**server/update.sh** — Zeile `GITHUB_REPO`:
```bash
GITHUB_REPO="DEIN_GITHUB_USERNAME/voice-dashboard"
```

### 3. GitHub Personal Access Token erstellen
- github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Berechtigungen: **Contents: Read & Write**, **Releases: Read & Write**
- Token kopieren (nur einmal sichtbar!)

---

## Update veröffentlichen

### Neue Version releasen (auf dem Entwicklungsrechner):

**1. Versionsnummer erhöhen** in `client/package.json`:
```json
"version": "1.0.1"
```

**2. Server packen:**
```bash
./release.sh v1.0.1
# → erstellt server.tar.gz
```

**3. Auf GitHub pushen:**
```bash
git add .
git commit -m "Release v1.0.1"
git tag v1.0.1
git push origin main --tags
```

**4. GitHub Release erstellen:**
- github.com → Releases → "Draft new release"
- Tag: `v1.0.1`
- `server.tar.gz` hochladen (aus Schritt 2)
- Release veröffentlichen

**5. Client-Installer bauen & hochladen:**
```
BUILD-AND-PUBLISH.bat ausführen (GitHub Token eingeben)
```
→ Lädt den Windows-Installer automatisch zum GitHub Release hoch

---

## Updates einspielen

### Client (Windows):
Der Client prüft **automatisch beim Start** auf Updates.
- Gelbe Leiste = Update verfügbar → "Jetzt laden"
- Grüne Leiste = Bereit → "Neustart & Installieren"

### Server (Linux):
```bash
cd /pfad/zu/voice-dashboard
./server/update.sh

# Erzwingen (auch wenn Version gleich):
./server/update.sh --force
```

---

## Ports
| Port        | Protokoll | Beschreibung         |
|-------------|-----------|----------------------|
| 3000        | TCP       | Signaling            |
| 40000-49999 | UDP       | WebRTC Audio         |
