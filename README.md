# 🎮 Live-Sub-Counter-Twitch - Animated Subscriber Counter for OBS

[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-black.svg)](https://socket.io/)
[![Twitch API](https://img.shields.io/badge/Twitch-API-9146FF.svg)](https://dev.twitch.tv/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A clean and modern OBS overlay that displays your Twitch subscriber count in real-time with smooth scroll animations. Perfect for streamers who want to showcase their sub progress with customizable goals.

![Twitch Sub Overlay Demo](https://via.placeholder.com/800x200/1a1a1a/ffffff?text=250+/+1500)

---

## ✨ Funktioner

- 📊 **Live sub count** - Uppdateras automatiskt var 15:e sekund
- 🎯 **Goal tracking** - Visar "subs / goal" (t.ex. "250 / 1500")
- 🎨 **Smooth animationer** - Siffror scrollar mjukt vid uppdateringar
- 🤖 **Chat commands** - Mods kan ändra goal med `!goal <nummer>`
- 🧪 **Test-sida** - Testa animationer utan att påverka live-overlay

## 📋 Krav

- Node.js (v16+)
- Ett Twitch-konto (broadcaster)
- Ett Twitch Bot-konto (för chat commands)
- Twitch App credentials (Client ID & Secret)

## 🚀 Installation

### 1. Klona/Ladda ner projektet

```bash
git clone <repository-url>
cd twitch-sub-overlay
npm install
```

### 2. Första start - Skapa .env

Vid första körning skapas automatiskt en `.env` fil från `.env.example`:

```bash
npm start
```

Du kommer se:
```
📝 .env fil saknas - skapar från .env.example...
✅ .env fil skapad! Fyll i dina credentials innan du fortsätter.
```

Öppna `.env` filen och fyll i dina uppgifter.

### 3. Skapa Twitch App

1. Gå till [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Klicka "Register Your Application"
3. Fyll i:
   - **Name**: Vad du vill (t.ex. "Sub Overlay")
   - **OAuth Redirect URLs**: `https://din-domän.se/auth/callback`
   - **Category**: Broadcasting Suite
4. Spara och kopiera **Client ID** och **Client Secret**

### 4. Konfigurera .env

Öppna `.env` filen och fyll i åtminstone dessa värden:

```env
TWITCH_CLIENT_ID=din_client_id_här
TWITCH_CLIENT_SECRET=din_client_secret_här
TWITCH_REDIRECT_URI=https://din-domän.se/auth/callback
```

Övriga värden är förfyllda med defaults som fungerar för de flesta!

### 5. Skaffa Bot Credentials (Optional)

För att aktivera `!goal` kommandot behöver du ett bot-konto:

1. Skapa ett nytt Twitch-konto för botten (t.ex. "DinKanalBot")
2. Gå till [Twitch Token Generator](https://twitchtokengenerator.com/)
3. Välj "Custom Scope Token"
4. Logga in med **bot-kontot**
5. Välj scopes: `chat:read` och `chat:edit`
6. Kopiera **Access Token** och **Refresh Token**
7. Lägg till i `.env`:
   ```env
   TWITCH_BOT_USERNAME=dinkanal_bot
   TWITCH_BOT_ACCESS_TOKEN=access_token_här
   TWITCH_BOT_REFRESH_TOKEN=refresh_token_här
   ```

### 5. Starta servern

```bash
npm start
```

### 6. Autentisera med Twitch

1. Öppna: `https://din-domän.se/auth/login`
2. Logga in med **broadcaster-kontot**
3. Godkänn permissions
4. Du bör se "Login ok. BroadcasterId: [ditt-id]"

### 7. Verifiera att allt fungerar

Besök: `https://din-domän.se/auth/status`

Kontrollera att:
- `loggedIn: true`
- `hasRequiredScope: true`
- `hasRefreshToken: true`

### 8. Ge Bot Mod-rättigheter

I din Twitch-chat, skriv:
```
/mod dinkanal_bot
```

## 🎥 Lägg till i OBS

1. Lägg till en **Browser Source** i OBS
2. URL: `https://din-domän.se/`
3. Width: `1920`, Height: `1080`
4. ✅ Kryssa i "Shutdown source when not visible"
5. Custom CSS (optional för transparent bakgrund):
   ```css
   body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }
   ```

## 🎮 Användning

### Live Overlay
- **URL**: `https://din-domän.se/`
- Visar live sub count och goal
- Uppdateras automatiskt

### Test-sida
- **URL**: `https://din-domän.se/test`
- Testa animationer utan att påverka live-overlay
- Simulera subs och ändra goal

### Chat Commands

Som moderator eller broadcaster:
```
!goal 2000    # Sätter goal till 2000
!goal 1500    # Sätter goal till 1500
```

## 🔧 Felsökning

### "Poll miss: missing_auth"
- Besök `/auth/status` och kontrollera `hasRefreshToken`
- Om false: gå till `/auth/login` och logga in igen

### "Poll miss: missing_scope"
- Gå till `/auth/force-login` för att logga in på nytt
- Se till att `TWITCH_SCOPES` i `.env` innehåller `channel:read:subscriptions`

### "Chat bot frånkopplad: Login unsuccessful"
- Kontrollera att bot credentials är korrekta i `.env`
- Verifiera att bot-kontot har `chat:read` och `chat:edit` scopes
- Se till att botten är mod i kanalen

### Goal-kommando fungerar inte
- Kontrollera att botten är ansluten (se server logs)
- Ge botten mod-rättigheter: `/mod dittbotkonto`
- Verifiera bot credentials i `.env`

## 📁 Projektstruktur

```
twitch-sub-overlay/
├── server.js           # Backend-server
├── public/
│   ├── overlay.html    # Live overlay
│   └── test.html       # Test-sida
├── package.json
├── .env                # Konfiguration (skapa själv)
└── README.md
```

## 🎨 Anpassning

### Ändra storlek på text
I `overlay.html`, ändra:
```css
#subCount {
  font-size: 5rem;  /* Justera storlek här */
}
```

### Ändra font
Overlay använder **Montserrat**. För att byta font, ändra Google Fonts länken i `<head>` sektionen.

### Ändra animationshastighet
I JavaScript-delen, ändra `duration`:
```javascript
animateCount(currentValue, count, 1000);  // 1000ms = 1 sekund
```

### Ändra polling-intervall
I `.env`:
```env
POLL_MS=15000  # Millisekunder (15000 = 15 sekunder)
```

## 🤝 Support

Om du stöter på problem:
1. Kolla server logs för felmeddelanden
2. Besök `/auth/status` för att verifiera autentisering
3. Kontrollera att alla credentials i `.env` är korrekta

## 📄 Licens

MIT License - Använd fritt!

---

## 🏷️ Keywords

`twitch` `obs` `overlay` `streaming` `twitch-api` `subscriber-counter` `obs-studio` `streamlabs` `socket-io` `nodejs` `express` `chat-bot` `stream-overlay` `twitch-bot` `broadcaster` `live-streaming` `obs-plugin` `twitch-overlay`

---

**Gjord med ❤️ för Twitch streamers**

⭐ Om du gillar detta projekt, ge det en stjärna på GitHub!

