# KIRIM — launch kit

Ready-to-post copy for the project account. Level 6 (Black Belt) requires a project profile
with real posts, so this doubles as preparation for it: everything here is written to be
posted now and to still make sense as the account's history later.

---

## Account setup

- **Handle:** `@kirimapp` (fallbacks: `@kirim_xyz`, `@kirimonstellar`)
- **Name:** KIRIM 🧧
- **Bio:**
  > Protected money transfers on @StellarOrg. Send it, they claim it with a link — nobody
  > claims, it comes back to you. Testnet live 👇
- **Link:** `https://kirim-app.netlify.app`
- **Avatar:** the 🧧 mark on the ember gradient (`#ff8c1a → #ff4d2d`)

---

## Pinned post — the recruitment ask

> I'm building **KIRIM** 🧧 — money transfers on Stellar that can come back to you.
>
> Send money → it waits in an escrow → they claim it with a link (no wallet needed up front).
> Nobody claims it? It returns to you.
>
> Live on testnet. I need 10 people to break it — one tap, 2 min:
> kirim-app.netlify.app/join

---

## Launch thread

**1/**
> Most crypto payments are fire-and-forget. One wrong address and the money is gone — and your
> recipient has to already own a wallet before you can send anything.
>
> KIRIM fixes both. 🧧
> A thread on what I shipped this month 👇

**2/**
> Instead of firing funds at an address, KIRIM locks them in a Soroban escrow.
>
> The recipient claims with a link. If nobody claims before the window closes, the money goes
> back to the sender — automatically.
>
> An undo button, for money.

**3/**
> The part I'm most proud of: **the recipient doesn't need a wallet when you send.**
>
> The claim link carries a secret; the contract only stores its hash. They install a wallet at
> claim time — and the app creates their account on the ledger for them.
>
> The funnel runs the right way round.

**4/**
> Under the hood:
> · Soroban escrow, multi-token (XLM + stablecoins)
> · time-locked claim / refund
> · 35 tests, CI on every push
> · self-hosted analytics — no cookies, no third party
>
> Code: github.com/AdityaWisnuu/kirim

**5/**
> Try it and tell me what's broken — blunt feedback is the useful kind:
> kirim-app.netlify.app/join
>
> Built for Stellar Journey to Mastery (@RiseInWeb3 × @StellarOrg). Onward to Blue Belt.

---

## Telegram / WhatsApp / campus groups

> Rek, butuh 10 orang buat nyoba app-ku 2 menit 🧧
>
> **KIRIM** — kirim uang di Stellar pakai escrow: penerima klaim lewat link, dan kalau nggak
> diklaim uangnya balik ke pengirim. Ini submission Level 4 program Rise In × Stellar.
>
> Caranya: buka **kirim-app.netlify.app/join** → connect wallet → tap sekali → klaim.
> Belum punya wallet? Ada panduan 2 menit di /try.
>
> Abis itu tolong isi feedback-nya (tombol 💬). Jujur aja, yang jelek justru paling kepake 🙏

---

## Cadence for Black Belt

Level 6 wants an active project profile, not a dormant one. Two posts a week is enough if each
one carries something real:

| When | Post |
|---|---|
| Ship day | What changed, with a screenshot or 10-second clip |
| Mid-week | One piece of user feedback and what you did about it |
| Milestone | Numbers straight from `/monitor` — transfers, claim rate, unique wallets |
| Occasional | A build note: a bug that taught you something, a design decision you reversed |

Rule of thumb: never post a claim you can't link to on-chain. The whole pitch of this project is
that the evidence is public — the account should behave the same way.
