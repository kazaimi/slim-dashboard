# slim-dashboard

Real-time **model pricing & stability dashboard** for [OpenCode](https://opencode.ai) relay stations (中转站), with browser-based token sync and **one-click model deployment** into `opencode.jsonc`.

![status](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## Features

- 💰 **Live pricing** — parses the relay's model-pricing bundle for every price group; per-model group picker with color-coded price tiers
- 📈 **Stability monitoring** — channel status, 7-day availability, latency and last-60-checks per channel, with automatic cache fallback when the relay API is down or the token expired
- 🔀 **Multi-relay ready** — define any number of relays in `config.json`; prices, channels and provider mappings are merged automatically
- 🧩 **Group overrides** — declarative rules to show official prices or custom multipliers (`gpt-* ×0.15`, synthetic groups like "Grok Heavy"…) — no code changes needed
- 🔑 **Browser token sync** — harvests session tokens from a debug Chrome window via CDP, persists them with `setx` and restarts the dashboard
- 🚀 **One-click deploy** — adds any relay model to `opencode.jsonc` from the UI (comment-preserving text insertion + validation + `.bak` backup)
- 🖱️ **Agent routing editor** — reorder agents by drag & drop and assign models; changes are saved back to `oh-my-opencode-slim.json`

## Quick start

```bash
npm install          # optional: only needed for token sync (playwright-core)
npm start            # dashboard at http://localhost:6388
```

No configuration is required for the built-in GeiliAPI defaults.

### CLI

```bash
node cli.js start                          # run the server
node cli.js sync-token [--relay geiliapi]  # harvest token from debug Chrome
node cli.js deploy --provider geili_gemini --model gemini-3.5-flash --context 1000000
```

## Token sync (one-time setup)

Relay monitor APIs usually require a session token that expires. slim-dashboard can pull it straight from your logged-in Chrome:

1. Close all Chrome windows.
2. Start Chrome with remote debugging enabled:
   ```
   chrome.exe --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\DashDebug" https://your-relay.com/monitor
   ```
   > Newer Chrome versions refuse debugging on the default profile directory — use a dedicated one as shown above.
3. Log in to the relay site once.
4. Run `node cli.js sync-token` (or click **Sync token** in the dashboard header).

The token is stored via `setx` under the env var configured in `tokenEnv` and the dashboard restarts automatically.

## Configuration

Copy [`config.example.json`](config.example.json) to `config.json` (gitignored). Every field is optional; without it the server uses built-in GeiliAPI defaults.

```jsonc
{
  "port": 6388,
  "relays": {
    "geiliapi": {
      "baseURL": "https://sub.geiliapi.com",
      "monitorPath": "/api/v1/channel-monitors",
      "providers": {                       // opencode provider -> price group + stability channel
        "geili_grok": { "priceGroup": "heavy", "channel": "Grok（Heavy）", "groupName": "Grok Heavy" }
      },
      "overrides": [                       // rewrite what the pricing bundle reports
        { "models": ["deepseek-v4-pro"], "group": "82", "useOfficial": true },
        { "models": ["gpt-*"], "group": "4", "multiplier": 0.15 }
      ],
      "syntheticGroups": [                 // virtual groups = officialPrice x multiplier
        { "id": "heavy", "baseGroup": "67", "models": ["grok-4.5", "grok-4.6"], "multiplier": 0.15 }
      ]
    }
  }
}
```

### Adding another relay station

Add a new key under `relays` with its own `baseURL`, `monitorPath`, `providers` mapping and `tokenEnv`. The dashboard merges its prices/stability automatically. If the new relay exposes a different monitor API, implement a small adapter (see `fetchStability` / `parseGeiliBundle` in `server.js`) and register it by setting `"type"` — PRs welcome.

## One-click deploy

Models listed under **Model health** that are not yet in your `opencode.jsonc` show a **Deploy** button. Clicking it:

1. backs up `opencode.jsonc` → `opencode.jsonc.bak`
2. inserts the model (or a whole provider block, using the relay's `providerTemplate`)
3. validates the result still parses before writing

Comments in your config are preserved — deployment uses targeted text insertion, never a full JSON round-trip.

## Project layout

```
├── server.js                  # HTTP server: state, save, deploy, token-sync APIs
├── cli.js                     # start / sync-token / deploy commands
├── scripts/
│   ├── sync-token.js          # CDP token harvester + setx + auto-restart
│   └── deploy-opencode.js     # comment-preserving opencode.jsonc writer
├── public/                    # vanilla JS/CSS frontend
├── config.example.json        # documented relay configuration template
└── price-fallback.json        # offline pricing snapshot (runtime data, gitignored)
```

## Security notes

- Never commit `config.json` — it may contain provider templates; API keys belong in environment variables (`{env:VAR}` references in `opencode.jsonc`).
- Stability cache files are gitignored.
- The debug Chrome port (9222) binds to localhost only, but anyone with local access could read those tabs — use a dedicated user-data dir for it.

## License

[MIT](LICENSE)
