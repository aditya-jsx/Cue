# Cue Privacy Policy

_Effective 7 October 2026. Cue is a voice-first wallet agent for Solana Mobile. This page says what Cue stores, what it
sends elsewhere, and how to remove it._

## The short version

- Cue has **no accounts**, **no ads**, **no analytics** and **no tracking**, and it **never sells** your data.
- Your wallet keys stay in your wallet. Cue never sees them.
- When you speak a command, a **short recording goes to Google's Gemini** (through Cue's server) so it can be
  understood. Cue's server does not keep it.
- Everything else Cue keeps stays **on your phone**, and you can delete it from Settings.
- Cue is not meant for people under 18.

## What stays on your phone

Cue stores these only on your device: the contacts you add (a name and a wallet address), your activity history, your
active rules, your settings, a random install id (see below), and a **session key** that lets Cue act inside a spending
limit you approve. The session key is encrypted with the Android Keystore. Your wallet address is shown in the app and
is public on Solana anyway.

## What is sent off your phone, and to whom

| What                                                                                                                       | Where                                                                                | Why                                                                         | Kept                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your voice command (a recording of up to about 9 seconds), the names of your contacts, and the list of tokens Cue supports | Cue's parser server (hosted on Vercel), which forwards it to **Google's Gemini API** | To turn what you said into an action, and to recognise your contacts' names | Cue's server does not store it. Google processes it under its [Gemini API terms](https://ai.google.dev/gemini-api/terms); depending on the account tier, Google may keep it for a limited time to detect abuse or, on its free tier, to improve its products |
| A random install id and your IP address                                                                                    | Cue's parser server                                                                  | To rate-limit requests so the service can't be abused                       | Counters only, for at most 24 hours; nothing links them to you or your wallet                                                                                                                                                                                |
| Blockchain requests (balances, prices, your signed transactions)                                                           | A Solana RPC provider (the default public endpoint, or one you choose)               | To read the chain and send transactions you approved                        | Transactions are public on Solana by nature. The RPC provider can see your IP address and wallet address                                                                                                                                                     |
| Swap quotes and swap transactions (mainnet only)                                                                           | [Jupiter](https://jup.ag)                                                            | To buy a token when a rule you set fires                                    | Governed by Jupiter's terms; the request names the tokens, the amount and Cue's session key address                                                                                                                                                          |

If you would rather not send audio at all, every action also works by hand from the **Do it yourself** buttons on Home,
and nothing is sent to the parser.

## The "Hey Cue" wake word

The wake word is detected **on your phone** by a small model that runs continuously while the microphone service is on.
That audio is not recorded or sent anywhere. Only after Cue hears "Hey Cue" (or you tap the mic) does it record your
command, and that recording is what goes to the parser as described above. You can turn the wake word off in Settings.

## Permissions Cue asks for

- **Microphone**, to hear your commands and the wake word.
- **Notifications**, to tell you when a rule fires or Portfolio Guard triggers.
- **Foreground service, wake lock, start after reboot and battery-optimisation exemption**, so your rules keep running
  with the screen off and after a restart.

You can change any of these in Android Settings. Without the microphone, the manual buttons still work.

## Deleting your data

- **In the app:** Settings → **Delete my data** removes your contacts, activity, rules, settings, install id and the
  session key from your phone and disconnects your wallet. If a spending permission is still active, Cue asks you to
  revoke it first (Settings → Permissions → Revoke), so nothing is left that you can no longer control.
- **Or** uninstall Cue, or clear its storage in Android Settings.
- **On-chain data** (your transactions) is public on Solana and cannot be deleted by anyone.
- Cue's server holds no account data about you, so there is nothing further to delete there.

## Third-party services

Cue relies on Google (Gemini API), Vercel (hosting), Upstash (rate-limit counters, when enabled), Jupiter (mainnet
swaps) and Solana RPC providers. Each handles data under its own terms.

## Changes and contact

If this policy changes, the new version replaces this page and the effective date above changes with it. Questions or
requests: open an issue at https://github.com/aditya-jsx/Cue/issues.
