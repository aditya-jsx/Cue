# Cue — Product Brief

**One-liner:** A voice-first AI wallet agent for Solana Mobile (Seeker). Say a command, the agent parses your intent, and executes it on-chain via hardware-backed signing — either immediately or autonomously later, within limits you explicitly pre-approved.

Built for the RadiantsDAO / Solana Mobile **Clock In** hackathon (Solana Mobile Stack + MWA), targeting the general prize pool and the separate SKR integration prize. Deadline: Oct 8, 2026, 11:59 PM PST.

**Platform:** Android, Expo / React Native (hackathon template) with a local Kotlin Expo module for the parts that must be native (wake-word foreground service, Keystore).

## The 3 supported intents

The agent recognizes exactly these three intents. Anything else returns a graceful "I can't do that yet" response rather than guessing.

### 1. Instant Send

Immediate, one-time action. Always requires a live MWA signature — never uses the delegated session key.

```json
{
  "intent": "instant_send",
  "token": "SOL" | "USDC" | "<other supported token symbol>",
  "amount": 2.0,
  "recipient": "Alex"
}
```

`recipient` is a saved contact or a raw wallet address. Example: "Send 2 SOL to Alex."

### 2. Conditional Buy

Registered as a standing trigger, monitored in the background, executed autonomously via the delegated session key when the condition is met.

```json
{
  "intent": "conditional_buy",
  "token": "JUP",
  "amount_usd": 20.0,
  "condition": "below" | "above",
  "threshold_usd": 0.85,
  "expires_at": "2026-10-04T00:00:00Z"
}
```

`expires_at` is optional and defaults to 24h. Example: "Buy $20 of JUP if it drops to 85 cents."

### 3. Portfolio Guard

A standing safety rule. Monitored in the background; on trigger, either alerts the user or executes a pause/de-risk action, per `action`.

```json
{
  "intent": "portfolio_guard",
  "threshold_pct": 10.0,
  "timeframe": "1h" | "24h",
  "action": "alert_only" | "pause_activity"
}
```

Example: "Pause everything if my portfolio drops 10% today."

## Screens

- **Home / Listening** — idle shows wallet balance and active rules; tapping the mic (or the wake word) enters a listening state with a waveform, then shows the parsed intent for confirmation before anything executes.
- **Delegation grant** — shown the first time a conditional_buy or portfolio_guard rule is created; explains in plain language what is authorized (token, cap, duration), requires one MWA/Seed Vault signature, and offers one-tap revoke.
- **Action log** — every action the agent has taken (instant sends, fired triggers), each linked to its on-chain transaction.
- **Settings** — manage active delegations (caps/expiry, revoke), toggle wake-word listening, manage saved contacts.

## Non-negotiables

- Wake-word listening (openWakeWord via ONNX Runtime Mobile, foreground service) with a tap-to-talk fallback that always works independently.
- Delegated automation via SPL Token `approve()` to an app-held session keypair (Keystore-protected). No custom on-chain program.
- Seed Vault / MWA for all user signatures. The app never handles the user's actual private key — only the capped, revocable session key.
- The LLM only parses. Deterministic code validates schema, token allowlist, caps and recipient before anything executes.
