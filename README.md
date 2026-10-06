# Cue

Cue is a voice-first AI wallet agent for Solana Mobile (Seeker). Say what you want, Cue shows exactly what it
understood, and nothing moves until you confirm it.

**Status:** hackathon build, **devnet only**. No mainnet funds are used.

## What it does

- **Send:** "Send 0.1 SOL to Alex". Confirm, then sign once in your wallet.
- **Conditional buy:** "Buy $5 of JUP if it drops to 30 cents". You grant a capped permission once. Cue then buys on
  its own when the price is hit, even with the app closed. The cap is enforced on-chain and you can revoke it in
  Settings. (On devnet the "buy" moves wrapped SOL to the session key. A real Jupiter swap is the mainnet step.)
- **Portfolio Guard:** "Alert me if my portfolio drops 10% today" or "Pause everything if it drops 15% in an hour".
- Every action also works manually from the **Do it yourself** tiles on Home.
- **"Hey Cue"** wake word (on-device model) and a mic button.

## How voice works

1. The phone records the command (`modules/cue-native`, `AudioCapture.kt`) and sends the audio to the parser server.
2. The server (`server/`, a Vercel function) asks Gemini to turn it into a structured intent and a transcript. The
   Gemini key lives only on the server.
3. The app validates the intent against hard rules (limits, known contacts, supported tokens) before showing it. The
   model only parses; it never decides what is allowed.
4. If the server is unreachable, Cue falls back to Android's speech recogniser and a local parser.

## Setup

Requires Node 20+, Android Studio / an Android device, and a Solana mobile wallet (e.g. Phantom) set to **devnet**.

1. Install dependencies.

   ```bash
   npm install
   ```

2. Configure the app. Copy the env template and fill it in (see "Parser server" below).

   ```bash
   cp .env.example .env
   ```

3. Build and run the Android development client (Expo Go will not work: Cue uses native modules).

   ```bash
   npm run android
   ```

## Parser server

```bash
cd server
npm install
vercel deploy --prod
```

Set these in the Vercel project's environment variables:

| Variable                                             | Purpose                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                                     | Google AI Studio key. Turn on billing for its project before real use: the free tier's daily quota is small |
| `CUE_CLIENT_TOKEN`                                   | Same value as `EXPO_PUBLIC_CUE_CLIENT_TOKEN` in the app's `.env`                                            |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional. Makes the rate limits exact across all instances (without it they are best effort)                |
| `CUE_DAILY_BUDGET`                                   | Optional. Most requests accepted per day in total (default 5000), a ceiling on the Gemini bill              |
| `GEMINI_MODELS`                                      | Optional. Comma-separated models to try in order, to swap one Google retires without a code change          |

Each install is limited to 20 requests a minute and 400 a day, and each IP address to 120 a minute and 2000 a day.

Then put the deployment URL in the app's `EXPO_PUBLIC_CUE_API_URL`.

## Checks

```bash
npm run build                      # typecheck + native prebuild
node scripts/check-parse-intent.mjs  # parser and validation cases
```

## Project layout

- `src/features/cue`: the Cue UI and flow (home, confirm, permission, settings, activity)
- `src/features/price-triggers`: buy and guard rules and their evaluation
- `src/features/wallet`: signing, sending and delegation transactions
- `modules/cue-native`: Android module (wake word, audio capture, speech fallback, price-heartbeat service)
- `server`: the intent-parsing function
- `docs/brief.md`: product brief
