# Hydra API Access Guide

This document covers how to authenticate with the Hydra backend API and query user data (games, achievements, profile) from a headless environment using Playwright + Chromium.

---

## Key URLs

| Service               | URL                                         |
| --------------------- | ------------------------------------------- |
| Marketing site        | `https://hydralauncher.gg`                  |
| **Auth (sign-in UI)** | `https://auth.hydralauncher.gg`             |
| **API base**          | `https://hydra-api-us-east-1.losbroxas.org` |
| CDN (assets)          | `https://cdn.losbroxas.org`                 |
| WebSocket             | `wss://ws.hydralauncher.gg`                 |

> These URLs come from `.github/workflows/*.yml` — the CI bakes them in as `MAIN_VITE_API_URL` and `MAIN_VITE_AUTH_URL`. The `.env.example` file only has empty placeholders, so always check the workflow files for the real values.

---

## Environment

- **Playwright**: `/opt/node22/lib/node_modules/playwright` (use ESM import path)
- **Chromium**: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  - Use `chromium-1194`, **not** `chromium-1223` — the newer build fails with `ERR_ECH_FALLBACK_CERTIFICATE_INVALID` on hydralauncher.gg
- **Node**: run scripts as `.mjs` files or with `--input-type=module`

### Required Chromium launch flags

```js
args: [
  "--no-sandbox",
  "--disable-quic",
  "--disable-features=EncryptedClientHello,TLS13EarlyData",
  "--disable-web-security",
  "--ignore-certificate-errors",
];
```

Without `--disable-features=EncryptedClientHello,TLS13EarlyData`, chromium-1194 may still throw ECH errors intermittently. `--disable-web-security` is needed for cross-origin fetch from page context.

---

## Authentication Flow

Authentication goes through the web UI at `https://auth.hydralauncher.gg`. The form has:

- `input[name="login"]` — username or email
- `input[name="password"]` — password

On submit, the browser POSTs to `https://hydra-api-us-east-1.losbroxas.org/auth/signin` and returns a JSON body with `accessToken` (JWT, 1-hour TTL) and `refreshToken`.

### Full sign-in script

```js
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const API_BASE = "https://hydra-api-us-east-1.losbroxas.org";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [
    "--no-sandbox",
    "--disable-quic",
    "--disable-features=EncryptedClientHello,TLS13EarlyData",
    "--disable-web-security",
    "--ignore-certificate-errors",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

let accessToken = null;

// Intercept the API response to capture the token
page.on("response", async (resp) => {
  if (resp.url().includes("auth/signin")) {
    const body = await resp.text().catch(() => "");
    try {
      accessToken = JSON.parse(body).accessToken;
    } catch {}
  }
});

await page.goto("https://auth.hydralauncher.gg/", {
  waitUntil: "networkidle",
  timeout: 30000,
});
await page.fill('input[name="login"]', "YOUR_USERNAME");
await page.fill('input[name="password"]', "YOUR_PASSWORD");
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);

console.log("Token:", accessToken);
```

---

## API Endpoints

All requests require the header:

```
Authorization: Bearer <accessToken>
```

### GET /profile/me

Returns the authenticated user's profile.

```js
const r = await fetch(`${API_BASE}/profile/me`, {
  headers: { Authorization: `Bearer ${token}` },
});
const profile = await r.json();
// profile.id  — user ID (e.g. "DjvmoDA5")
// profile.username
// profile.email
// profile.displayName
```

### GET /profile/games

Returns all games in the user's library with metadata and achievement counts.

```js
const r = await fetch(`${API_BASE}/profile/games`, {
  headers: { Authorization: `Bearer ${token}` },
});
const games = await r.json();
// Each game object has:
// - title, shop, objectId
// - achievementCount        — total possible achievements
// - achievementsPointsEarnedSum
// - playTimeInSeconds
// - lastTimePlayed
```

### GET /users/:userId/games/achievements?shop=&objectId=

Returns achievement details for a specific game.

```js
const r = await fetch(
  `${API_BASE}/users/${userId}/games/achievements?shop=steam&objectId=924970`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const achievements = await r.json();
```

> **Note**: Use `userId` from `/profile/me` response (`profile.id`). Using your own ID works fine; the "compare" endpoint rejects self-requests.

### POST /auth/signin (direct, if needed)

Called automatically by the auth UI, but you can also call it directly:

```js
const r = await fetch(`${API_BASE}/auth/signin`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: "USERNAME", password: "PASSWORD" }),
});
const { accessToken, refreshToken, expiresIn } = await r.json();
```

### POST /auth/logout

```js
await fetch(`${API_BASE}/auth/logout`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
```

---

## Complete Example: List Games with Achievements

```js
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const API_BASE = "https://hydra-api-us-east-1.losbroxas.org";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [
    "--no-sandbox",
    "--disable-quic",
    "--disable-features=EncryptedClientHello,TLS13EarlyData",
    "--disable-web-security",
    "--ignore-certificate-errors",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

let accessToken = null;
page.on("response", async (resp) => {
  if (resp.url().includes("auth/signin")) {
    const body = await resp.text().catch(() => "");
    try {
      accessToken = JSON.parse(body).accessToken;
    } catch {}
  }
});

await page.goto("https://auth.hydralauncher.gg/", {
  waitUntil: "networkidle",
  timeout: 30000,
});
await page.fill('input[name="login"]', "YOUR_USERNAME");
await page.fill('input[name="password"]', "YOUR_PASSWORD");
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);

if (!accessToken) throw new Error("Auth failed");

const [profile, games] = await page.evaluate(
  async ({ base, token }) => {
    const headers = { Authorization: `Bearer ${token}` };
    const [p, g] = await Promise.all([
      fetch(`${base}/profile/me`, { headers }).then((r) => r.json()),
      fetch(`${base}/profile/games`, { headers }).then((r) => r.json()),
    ]);
    return [p, g];
  },
  { base: API_BASE, token: accessToken }
);

console.log(`User: ${profile.username} (${profile.id})`);
console.log(`Total games: ${games.length}`);

const withAchievements = games.filter((g) => g.achievementCount > 0);
console.log(`\nGames with achievements (${withAchievements.length}):`);
for (const g of withAchievements) {
  console.log(`  ${g.title} — ${g.achievementCount} achievements`);
}

await browser.close();
```

---

## Caveats

- **`api.hydralauncher.gg` does not exist in DNS** — always use `hydra-api-us-east-1.losbroxas.org`
- **`https://hydralauncher.gg/auth/sign-in` is a 404** — the marketing site has no auth page; use `auth.hydralauncher.gg`
- The access token expires in **1 hour** (`expiresIn: 3600`). Use the `refreshToken` to get a new one via `POST /auth/refresh`
- All `page.evaluate()` fetch calls run inside the browser context, which avoids CORS issues that would block direct `node-fetch` calls to the API
- The `stealth-browser` skill (Python/nodriver on port 6222) is an alternative but the Playwright approach above is simpler for this use case
