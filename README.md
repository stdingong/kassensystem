# Kassensystem

Kassensystem für Party, Flohmarkt & Co. – läuft in der Cloud, auf allen Geräten nutzbar.

---

## Deployment auf Railway (kostenlos)

### Schritt 1: GitHub-Konto erstellen
Falls noch nicht vorhanden: https://github.com/signup

### Schritt 2: Neues Repository anlegen
1. Gehe zu https://github.com/new
2. Name: `kassensystem`
3. Klicke auf **"Create repository"**

### Schritt 3: Dateien hochladen
1. Klicke auf **"uploading an existing file"**
2. Lade alle Dateien aus diesem ZIP hoch:
   - `server.js`
   - `package.json`
   - `railway.json`
   - `.gitignore`
   - Ordner `public/` mit `index.html`
3. Klicke auf **"Commit changes"**

### Schritt 4: Railway-Konto erstellen
1. Gehe zu https://railway.app
2. Klicke auf **"Login"** → **"Login with GitHub"**

### Schritt 5: Projekt deployen
1. Klicke auf **"New Project"**
2. Wähle **"Deploy from GitHub repo"**
3. Wähle dein `kassensystem` Repository
4. Railway erkennt automatisch Node.js und startet den Server

### Schritt 6: URL abrufen
1. Klicke auf dein Projekt → **"Settings"** → **"Domains"**
2. Klicke auf **"Generate Domain"**
3. Du bekommst eine URL wie: `kassensystem-xxxx.up.railway.app`

### Fertig!
Diese URL auf allen Geräten öffnen – alle greifen auf dieselbe Datenbank zu.

---

## Lokales Testen (optional)

```bash
npm install
node server.js
```

Dann im Browser: http://localhost:3000

---

## Funktionen
- Kassensystem mit Warenkorb
- Produkte verwalten (hinzufügen / löschen)
- Kategorien filtern
- Bargeld & Kartenzahlung
- Tagesstatistik mit Umsatz, Ø Bon, Bargeld/Karte-Aufschlüsselung
- Tagesabschluss
- Alle Geräte im selben WLAN / Internet greifen auf dieselben Daten zu
