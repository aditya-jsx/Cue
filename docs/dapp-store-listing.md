# Cue on the Solana dApp Store: listing and submission

Everything to paste into the publisher portal (https://publish.solanamobile.com), plus the checklist. Nothing here needs
a secret. The wallet keypair, the signing keystore and the portal login stay with you.

## Read this first: timing

- Publisher signup includes **KYC/KYB verification**, and review takes **3–5 business days** after submission. An app only
  goes live once it is approved, so a live listing by the 8 October deadline is unlikely whatever we do. **Start the
  signup today**, and submit as early as possible so Cue is in the review queue. Ask the hackathon whether a submitted,
  in-review listing satisfies the requirement.
- Submitting needs a **signed release APK** (roadmap #9). It cannot be submitted without one.

## Listing fields

**Name:** Cue

**Package name (must match the APK):** `com.cue.app`

**Short description:** Say it. Cue does it. A voice-first wallet agent for Solana Mobile.

**Description:**

> Cue is a voice-first wallet agent for Solana Mobile. Tell it what you want and it shows exactly what it understood
> before anything moves.
>
> • **Send:** "Send 0.1 SOL to Alex." Cue repeats it back, then you sign once in your wallet.
> • **Buy on a price:** "Buy $5 of JUP if it drops to 30 cents." You approve a capped permission once, and Cue buys for
> you when the price is hit, even with the app closed. The cap is enforced on-chain by Solana, and you can revoke it
> any time.
> • **Portfolio Guard:** "Alert me if my portfolio drops 10% today." Get a notification, or pause your buy rules.
>
> Say "Hey Cue" from anywhere (the wake word is detected on your phone), tap the mic, or use the buttons on Home.
> Everything also works by hand, so you never have to talk to it.
>
> **Non-custodial.** Your keys stay in your wallet. Cue works inside the limits you approve and never sees your keys.
>
> **About this release.** It runs on Solana **devnet** (the test network). On devnet, "buy" moves test tokens as a
> demonstration instead of swapping on a market. Real swaps on mainnet are in development and not part of this release.
>
> **Voice and privacy.** Each spoken command is sent to Google's Gemini through Cue's server to be understood, and Cue
> does not keep it. Read the full policy before you use voice. Cue is not financial advice.

**What's new:** Initial release.

**Suggested category:** Finance (or Productivity if Finance asks for financial-services documentation: see below).

**Keywords:** voice, wallet, AI agent, Solana, send, price alert, portfolio guard, hands-free, Seeker

**Privacy policy URL:** https://github.com/aditya-jsx/Cue/blob/main/PRIVACY.md

**Support / website:** https://github.com/aditya-jsx/Cue (issues: https://github.com/aditya-jsx/Cue/issues)

## Assets

| Asset                  | Status                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| App icon               | `assets/images/icon.png`, 1024×1024. Ready.                                   |
| Banner / feature image | `og-image.png` is 1200×630. The portal will say whether it accepts that size. |
| Screenshots            | **Not captured yet.** They need your phone (below).                           |

**Screenshot shot list** (capture with the phone connected: `adb exec-out screencap -p > shot-1.png`):

1. Home: balance, an active rule and the mic button
2. Listening: the waveform while you speak
3. Confirm screen after a voice send, showing the "You said" line
4. Conditional buy confirm ("Buy $5 of JUP when it falls to $0.20")
5. The permission screen with the on-chain hard limit
6. Portfolio Guard confirm, pause mode selected
7. Activity log with a bought rule and a guard trigger
8. Settings: Permissions, Run in background, Spoken replies, Delete my data

## Honesty checks against the Publisher Policy

The policy forbids content that "misleads users as to the true intent, nature, or purpose" of an app. Before submitting:

- **Say what this build is.** As submitted it runs on devnet and "buy" is a stand-in. The description above says so. If
  you ship the mainnet swap instead, change the "About this release" paragraph to match what the build really does.
- **Privacy policy:** required, and it must disclose third parties that see user data. `PRIVACY.md` does (Google Gemini,
  Vercel, Jupiter, RPC providers).
- **Deleting data:** required. Settings → **Delete my data** does it.
- **Financial services:** the policy asks apps that provide regulated financial services to supply the legal
  documentation. Cue is a non-custodial tool with no custody, no advice and no fees, and the listing says it is not
  financial advice. If the portal asks, answer that honestly.
- **Third-party obligations:** the policy asks developers to obligate third-party services to follow it. Cue uses
  Google's and Jupiter's standard terms and cannot negotiate its own.

## Submission steps

1. Sign up at https://publish.solanamobile.com and complete **KYC/KYB** (start now).
2. Prepare the **publisher wallet**: a keypair you control long-term. It signs every future release, and losing it means
   losing the ability to update the app. Fund it with about **0.2 SOL (mainnet)** for fees and storage; use the portal's
   quoted number.
3. In the portal choose a storage provider (ArDrive is recommended; top up its balance as the estimate says).
4. **Add a dApp** and fill in the fields above. The package name must match the APK.
5. Build and sign the release APK (roadmap #9), check its signer with `apksigner verify --print-certs`, then
   **New Version**, upload it and approve every signing prompt (skipping one leaves assets missing).
6. Wait for review (3–5 business days). Results come from `publishersupport@dappstore.solanamobile.com`.

**Where I stop for you:** I won't use your wallet, mint the App NFT, spend any SOL or enter your identity details. Each of
those is yours to do in the portal.
