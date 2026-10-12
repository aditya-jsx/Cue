# Cue demo video: shot list

Target: under 3 minutes. Record on the phone with Android's screen recorder, sound set to **"Media and microphone"** so
both your voice and Cue's are captured. One clip per shot is easiest; send them over and they get cut together with
titles. Speak naturally, in one breath after "Hey Cue" (no need to wait for the chime).

Before recording:
- Network: **Mainnet** (or Devnet if you'd rather not use real SOL; the shots are the same).
- Voice approvals on, with about 0.1 SOL (enough for the sends and the $5 rule). A saved contact "Alex" (or use a `.skr` name you own).
- Do not disturb on, so no other notifications show up. Battery saver off.
- Swipe Cue away from recents before shot 1, so the intro plays.

| # | Shot | What you do / say | What viewers see and hear | ~sec |
|---|------|-------------------|---------------------------|------|
| 1 | Open | Tap the Cue icon | The "Cue" logo writes itself, then Home: balance, tokens card, "Cue can spend X SOL by voice" | 8 |
| 2 | A question | "Hey Cue, what's my balance?" | Cue answers out loud; the answer shows on Home | 10 |
| 3 | A price | "Hey Cue, what's SKR at?" | Spoken SKR price | 8 |
| 4 | Voice-approved send | "Hey Cue, send 0.01 SOL to Alex" → Cue reads it back → "approve" | "You said approve. Sending…", then the success screen with the signature | 20 |
| 5 | Seeker name | "Hey Cue, send 0.01 SOL to priya.skr" → "decline" | The name resolves to a wallet; "Okay, cancelled." | 15 |
| 6 | A rule | "Hey Cue, buy $5 of JUP if it drops to 30 cents" → "approve" | The rule appears under Home's rules | 15 |
| 7 | An alert | "Hey Cue, alert me if SOL goes above 200 dollars" → "approve" | The alert appears under rules | 12 |
| 8 | Off screen | Press Home. On the phone's home screen: "Hey Cue, what's my balance?" | Cue answers without opening; a notification shows the answer | 12 |
| 9 | Off screen send | Still on the home screen: "Hey Cue, send 0.01 SOL to Alex" → "approve" | Spoken exchange; "Done" notification | 20 |
| 10 | Lock screen | Lock the phone, wake the screen (don't unlock): "Hey Cue, what's the price of JUP?" | Spoken answer on the lock screen | 10 |
| 11 | Swap | In the app: "Hey Cue, swap 1 JUP to SOL" → Continue → approve in Phantom | The confirm sheet shows the 0.5% Cue fee; Phantom shows the swap; success screen | 20 |
| 12 | Safety | Settings → Voice approvals: show the allowance, then tap Revoke and approve in Phantom | "Cue holds X SOL" goes to zero; the SOL is back in the wallet | 15 |
| 13 | Close | Home screen, Quick Settings: tap "Talk to Cue" | Listening opens from the tile | 5 |

Shot 6, 7 and 12 are optional if time is short; 1, 2, 4, 8 and 9 are the heart of the demo.

Voice-over to record afterwards (or say live), one line per section:

1. "This is Cue, a voice-first wallet for Solana Mobile. You say what you want done, and it does it."
2. "Questions get spoken answers."
3. "Money moves only within an allowance you approved on-chain, and only to names you know: contacts or Seeker names."
4. "Rules and alerts keep running in the background, even after a reboot."
5. "And it works without opening the app: from the home screen, or even the lock screen."
6. "Swaps go through Jupiter and are approved in Phantom; Cue earns a 0.5% fee on buys and swaps."
7. "Revoke any time, and the unspent SOL comes back. Download Cue at cue-app-one.vercel.app."
