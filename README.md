# 🧾 Kassensystem – Multi-Floor

Kassensystem für Party & Flohmarkt mit mehreren Bars/Floors.

## Funktionen
- **Mehrere Bars** (Kellerbar, Erdgeschossbar – erweiterbar)
- **Pro Bar eigene Produkte** mit Kategorien
- **Inline-Zahlung** – kein Popup, alles auf einer Seite
- **Bargeld** mit Scheinen-Schnellwahl & Rückgeldrechnung
- **PayPal** Bestätigung
- **Live-Statistik** mit Produktranking & Abend-Charts (WebSocket)
- **PIN-Schutz** für Statistik & Tagesabschluss (Standard: `1234`)
- **Admin-Passwort** für Produkte & Einstellungen (Standard: `admin123`)
- **Multi-Gerät**: alle Geräte greifen auf dieselbe Datenbank zu

---

## Deployment auf Railway (kostenlos)

### 1. GitHub Repository anlegen
1. https://github.com/new → Name: `kassensystem`
2. „uploading an existing file" → alle Dateien aus diesem ZIP hochladen
3. „Commit changes"

### 2. Railway deployen
1. https://railway.app → Login with GitHub
2. „New Project" → „Deploy from GitHub repo" → dein Repository
3. Railway startet automatisch

### 3. URL generieren
Settings → Domains → „Generate Domain"
→ z.B. `kassensystem-xxxx.up.railway.app`

### 4. Fertig!
URL auf allen Geräten öffnen – alle arbeiten auf derselben Datenbank.

---

## Lokal testen
```bash
npm install
node server.js
# → http://localhost:3000
```

---

## Standard-Zugangsdaten
| Rolle      | Zugangsdaten     |
|------------|------------------|
| Kassierer  | PIN: `1234`      |
| Admin      | Passwort: `admin123` |

**Bitte sofort nach dem ersten Login ändern!**  
→ Admin-Button → Zugangsdaten ändern
