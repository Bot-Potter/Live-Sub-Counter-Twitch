// server.js
import express from "express";
import fetch from "node-fetch";
import path from "path";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import tmi from "tmi.js";

// Auto-create .env from .env.example if it doesn't exist
const __dirname = path.resolve();
const ENV_PATH = path.join(__dirname, ".env");
const ENV_EXAMPLE_PATH = path.join(__dirname, ".env.example");

if (!fs.existsSync(ENV_PATH)) {
  console.log("📝 .env fil saknas - skapar från .env.example...");
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
    console.log("✅ .env fil skapad! Fyll i dina credentials innan du fortsätter.");
    console.log("📍 Redigera: " + ENV_PATH);
    process.exit(0);
  } else {
    console.error("❌ Varken .env eller .env.example hittades!");
    process.exit(1);
  }
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.static(path.join(__dirname, "public")));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

let cachedToken = null;
let tokenExpiresAt = 0;
let currentSubCount = 0;
let goalValue = 1500; // Default goal
// OAuth user token state
let userAccessToken = null;
let userRefreshToken = null;
let userTokenExpiresAt = 0;
let broadcasterId = process.env.TWITCH_BROADCASTER_ID || null;
const REQUIRED_SCOPE = "channel:read:subscriptions";
const OAUTH_SCOPES = Array.from(new Set([...(process.env.TWITCH_SCOPES || "channel:read:subscriptions").split(" "), REQUIRED_SCOPE]));
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI;

const POLL_INTERVAL = Number(process.env.POLL_MS || 15000);

let userScopes = [];

// Bot token state
let botAccessToken = null;
let botRefreshToken = null;
let botTokenExpiresAt = 0;

async function getAppToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000 - 60000;
  return cachedToken;
}

// User token helpers
function userTokenValid() {
  return userAccessToken && Date.now() < userTokenExpiresAt - 30000;
}

async function refreshUserTokenIfNeeded() {
  if (userTokenValid() || !userRefreshToken) return;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: userRefreshToken,
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Failed to refresh user token");
  const oldRefresh = userRefreshToken;
  userAccessToken = data.access_token;
  userRefreshToken = data.refresh_token || userRefreshToken;
  userTokenExpiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token && data.refresh_token !== oldRefresh) {
    persistRefreshToken(userRefreshToken);
  }
}

// Bot token helpers
function botTokenValid() {
  return botAccessToken && Date.now() < botTokenExpiresAt - 30000;
}

async function refreshBotTokenIfNeeded() {
  if (botTokenValid() || !botRefreshToken) return;
  
  // Använd huvudappens client credentials för att refresha bot token
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: botRefreshToken,
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Failed to refresh bot token:", data);
    return;
  }
  
  botAccessToken = data.access_token;
  botRefreshToken = data.refresh_token || botRefreshToken;
  botTokenExpiresAt = Date.now() + data.expires_in * 1000;
  console.log("✅ Bot token refreshad");
}

function persistRefreshToken(rt) {
  try {
    let env = "";
    try { env = fs.readFileSync(ENV_PATH, "utf8"); } catch {}
    if (env.includes("TWITCH_USER_REFRESH_TOKEN=")) {
      env = env.replace(/TWITCH_USER_REFRESH_TOKEN=.*/g, `TWITCH_USER_REFRESH_TOKEN=${rt}`);
    } else {
      env += (env.endsWith("\n") ? "" : "\n") + `TWITCH_USER_REFRESH_TOKEN=${rt}\n`;
    }
    fs.writeFileSync(ENV_PATH, env, "utf8");
    console.log("✅ Sparade TWITCH_USER_REFRESH_TOKEN i .env");
  } catch (e) {
    console.warn("Kunde inte spara refresh token till .env:", e.message);
  }
}

async function exchangeCode(code) {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("OAuth code exchange failed");
  userAccessToken = data.access_token;
  userRefreshToken = data.refresh_token;
  userTokenExpiresAt = Date.now() + data.expires_in * 1000;
  persistRefreshToken(userRefreshToken);
  await ensureBroadcasterId();
  await validateUserToken();
}

async function ensureBroadcasterId() {
  await validateUserToken(); // ensure broadcasterId from token if possible
  if (broadcasterId) return;
  if (!userAccessToken) return;
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${userAccessToken}`,
    },
  });
  const data = await res.json();
  if (res.ok && data?.data?.[0]?.id) {
    broadcasterId = data.data[0].id;
    console.log("✅ Hittade broadcasterId:", broadcasterId);
  } else {
    console.warn("Kunde inte hämta broadcasterId", data);
  }
}

async function validateUserToken() {
  if (!userAccessToken) return;
  try {
    const res = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${userAccessToken}` }
    });
    const data = await res.json();
    if (res.ok && data?.scopes) {
      userScopes = data.scopes;
      if (!userScopes.includes(REQUIRED_SCOPE)) {
        console.warn("Saknar scope:", REQUIRED_SCOPE, "nuvarande:", userScopes);
      }
    } else {
      console.warn("Kunde inte validera token:", data);
    }
    // Sync broadcasterId with the token owner to avoid mismatch
    if (res.ok && data?.user_id && broadcasterId !== data.user_id) {
      broadcasterId = data.user_id;
      console.log("✅ Broadcaster satt från token:", broadcasterId);
    }
  } catch (e) {
    console.warn("Validate token fel:", e.message);
  }
}

function hasRequiredScope() {
  return userScopes.includes(REQUIRED_SCOPE);
}

async function fetchSubCount(retry = true) {
  await refreshUserTokenIfNeeded();
  if (!userTokenValid()) throw new Error("missing_auth");
  await ensureBroadcasterId();
  if (!broadcasterId) throw new Error("missing_broadcaster");

  const twitchRes = await fetch(
    `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${userAccessToken}`,
      },
    }
  );
  const data = await twitchRes.json();

  if (!twitchRes.ok) {
    const msg = (data && data.message) || "";
    // Handle typical auth/scope issues
    if (twitchRes.status === 401) {
      if (/Missing scope/i.test(msg)) throw new Error("missing_scope");
      if (/invalid oauth token|invalid token/i.test(msg)) {
        userAccessToken = null;
        userRefreshToken = null;
        userTokenExpiresAt = 0;
        throw new Error("missing_auth");
      }
    }
    // Retry once if broadcaster_id must match token user
    if ((twitchRes.status === 400 || twitchRes.status === 401 || twitchRes.status === 403)
        && /must match the user id/i.test(msg)) {
      if (retry) {
        broadcasterId = null;
        await ensureBroadcasterId();
        return fetchSubCount(false);
      }
    }
    const err = new Error("twitch_api_error");
    err.status = twitchRes.status;
    err.detail = data;
    throw err;
  }

  return data.total ?? data.data?.length ?? 0;
}

async function poll() {
  try {
    const newCount = await fetchSubCount();
    if (newCount !== currentSubCount) {
      currentSubCount = newCount;
      io.emit("subcount", currentSubCount);
    }
  } catch (e) {
    console.warn("Poll miss:", e.message, e.status || "", e.detail || "");
  }
}

// Starta först efter auth-init så vi slipper "missing_auth"
(async function initAuthAndStart() {
  // Broadcaster auth
  if (process.env.TWITCH_USER_REFRESH_TOKEN) {
    userRefreshToken = process.env.TWITCH_USER_REFRESH_TOKEN;
    try {
      await refreshUserTokenIfNeeded();
      await validateUserToken();
      await ensureBroadcasterId();
      console.log("✅ Återställde Twitch-inloggning från refresh token");
    } catch (e) {
      console.warn("Kunde inte återställa token:", e.message);
    }
  }
  
  // Bot auth
  if (process.env.TWITCH_BOT_REFRESH_TOKEN) {
    botRefreshToken = process.env.TWITCH_BOT_REFRESH_TOKEN;
    botAccessToken = process.env.TWITCH_BOT_ACCESS_TOKEN;
    if (botAccessToken) {
      botTokenExpiresAt = Date.now() + 3600000; // Assume 1 hour valid
    }
    try {
      await refreshBotTokenIfNeeded();
      console.log("✅ Bot token laddat");
    } catch (e) {
      console.warn("Kunde inte ladda bot token:", e.message);
    }
  }
  
  setInterval(poll, POLL_INTERVAL);
  poll();
})();

// Twitch Chat Bot
let twitchClient = null;
let channelName = null;

async function getChannelName() {
  if (!broadcasterId) return null;
  try {
    const res = await fetch(`https://api.twitch.tv/helix/users?id=${broadcasterId}`, {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${await getAppToken()}`,
      },
    });
    const data = await res.json();
    return data?.data?.[0]?.login || null;
  } catch (e) {
    console.warn("Kunde inte hämta channel name:", e.message);
    return null;
  }
}

async function initTwitchChat() {
  if (!broadcasterId) {
    console.log("⏳ Väntar på broadcaster ID innan chat startar...");
    return;
  }

  // Kolla om bot credentials finns
  const botUsername = process.env.TWITCH_BOT_USERNAME;

  if (!botUsername || !botAccessToken) {
    console.log("⚠️ Bot credentials saknas eller bot token inte laddat");
    console.log("Chat bot kommer inte att startas. Sätt TWITCH_BOT_* variabler för att aktivera !goal kommando.");
    return;
  }

  // Refresh bot token innan vi ansluter
  await refreshBotTokenIfNeeded();

  channelName = await getChannelName();
  if (!channelName) {
    console.warn("Kunde inte hitta channel name för chat bot");
    return;
  }

  twitchClient = new tmi.Client({
    options: { debug: false },
    identity: {
      username: botUsername,
      password: `oauth:${botAccessToken}`,
    },
    channels: [channelName],
  });

  twitchClient.on("message", async (channel, tags, message, self) => {
    if (self) return;

    const isMod = tags.mod || tags.badges?.broadcaster === "1";
    const msg = message.trim();

    // !goal <number> - uppdatera goal (mods only)
    if (msg.startsWith("!goal") && isMod) {
      const args = msg.split(" ");
      if (args.length === 2) {
        const newGoal = parseInt(args[1]);
        if (!isNaN(newGoal) && newGoal > 0) {
          goalValue = newGoal;
          io.emit("goal", goalValue);
          console.log(`✅ Goal uppdaterat till ${goalValue} av ${tags.username}`);
          twitchClient.say(channel, `Goal uppdaterat till ${goalValue}!`);
        }
      }
    }
  });

  twitchClient.on("connected", () => {
    console.log(`✅ Twitch chat bot ansluten till #${channelName}`);
  });

  twitchClient.on("disconnected", (reason) => {
    console.log("⚠️ Chat bot frånkopplad:", reason);
  });

  try {
    await twitchClient.connect();
  } catch (e) {
    console.warn("⚠️ Kunde inte ansluta chat bot (detta är OK om du inte vill ha !goal kommando):", e.message);
    twitchClient = null;
  }
}

// Starta chat bot efter auth
setTimeout(() => {
  if (broadcasterId) initTwitchChat();
}, 2000);

io.on("connection", (socket) => {
  socket.emit("subcount", currentSubCount);
  socket.emit("goal", goalValue);
});

// OAuth routes
app.get("/login", (req, res) => {
  res.redirect("/auth/login");
});

app.get("/auth/login", (req, res) => {
  if (!REDIRECT_URI) return res.status(500).send("Missing TWITCH_REDIRECT_URI");
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", process.env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  res.redirect(url.toString());
});

app.get("/auth/force-login", (req, res) => {
  if (!REDIRECT_URI) return res.status(500).send("Missing TWITCH_REDIRECT_URI");
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", process.env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("force_verify", "true");
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send("OAuth error: " + error);
  if (!code) return res.status(400).send("Missing code");
  try {
    await exchangeCode(code);
    res.send("Login ok. BroadcasterId: " + broadcasterId);
    poll(); // trigger immediate update
    // Start chat bot efter inloggning
    if (!twitchClient) {
      initTwitchChat();
    }
  } catch (e) {
    res.status(500).send("Callback error: " + e.message);
  }
});

app.get("/auth/status", (req, res) => {
  res.json({
    loggedIn: userTokenValid(),
    broadcasterId: broadcasterId || null,
    expiresInMs: userTokenValid() ? userTokenExpiresAt - Date.now() : 0,
    scopes: userScopes,
    hasRequiredScope: hasRequiredScope(),
    requiredScope: REQUIRED_SCOPE,
    hasRefreshToken: Boolean(userRefreshToken)
  });
});

app.get("/subcount", async (req, res) => {
  try {
    const count = await fetchSubCount();
    currentSubCount = count;
    io.emit("subcount", currentSubCount);
    res.json({ count });
  } catch (err) {
    if (["missing_auth","missing_scope","missing_broadcaster"].includes(err.message)) {
      return res.status(401).json({ error: err.message });
    }
    if (err.message === "twitch_api_error") {
      return res.status(502).json({ error: "twitch_api_error", status: err.status, detail: err.detail });
    }
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "overlay.html"));
});

app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "test.html"));
});

httpServer.listen(PORT, () => {
  console.log(`✅ Twitch sub overlay körs på port ${PORT}`);
  console.log(`📺 Overlay: http://localhost:${PORT}/`);
  console.log(`🎮 Test: http://localhost:${PORT}/test`);
});
