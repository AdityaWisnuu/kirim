# Load test & user-experience findings

Two questions, measured rather than assumed: *what does one person feel using this?* and
*what happens when a crowd arrives at once?* The second one found a defect that would have
quietly ruined the first real launch.

## 1 · Single-user journeys (Playwright, live site)

Seven journeys on a 390px phone and a 1280px desktop, checking what the person actually sees:
the right content, no horizontal scroll, no console errors, and a first paint under 8 seconds.

| Journey | Result |
|---|---|
| Home — send form and primary call to action | ✅ 2.4s |
| `/join` — request a transfer, with an exit for people without a wallet | ✅ 1.0s |
| `/try` — the three-step wallet guide | ✅ |
| `/claim` — a transfer already settled | ✅ 4.1s |
| `/claim` — a link opened without its secret | ✅ explains itself, no dead end |
| `/claim` — a transfer that does not exist | ✅ names the problem, offers a way back |
| `/monitor` — on-chain metrics and product funnel | ✅ 5.2s |

**35/35 checks pass.** Re-run with `node ux-test.mjs` (see `web/scripts/`).

## 2 · A crowd arriving at once — the defect

Simulating ten people tapping *Send me a test transfer* in the same second, which is precisely
what happens when a link is posted to a group chat:

| | Before | After |
|---|---|---|
| People who got a transfer | **2 / 10** | **10 / 10** |
| What the other eight saw | `504` after ~37s — a blank timeout | — |
| Longest wait | 37.8s | 11.4s |

### Why it failed

Every request signed and submitted a Stellar transaction *at request time*, all from one
onboarding account. Concurrent requests queued behind a single account's sequence numbers and
behind shared contract state, until the serverless gateway gave up and returned `504` with no
message at all.

The damage was not the failure itself — it was that the failure was **invisible and
misattributed**. Eight people would have shrugged and closed the tab, and the conclusion would
have been "nobody wants to try this" rather than "the app broke".

### The fix

Move the chain work off the request path. `scripts/mint-pool.mjs` mints claim links ahead of
time; `/api/invite` now just hands one out. The slot is derived from the caller's own address
(`sha256(address) % pool_size`, probing forward on collision), so simultaneous callers never
contend for the same entry, and a repeat request from the same address always returns the same
link — idempotent by construction.

Account creation still happens per request, but friendbot funding is independent per address
and parallelises cleanly.

## 3 · Contract-level concurrency — a known limit

Measured on a **separate throwaway contract instance**, never on the production one — synthetic
wallets would pollute the `unique wallets` metric that `/monitor` reports as real adoption, and
an honest stress test has to be free to break things.

| Pattern | Result |
|---|---|
| 8 transfers fired simultaneously, 8 distinct funded wallets | **1 / 8 succeed** |
| The same 8 transfers, one second apart | **8 / 8 succeed** |
| 25 simultaneous | 1 / 25 · p50 latency 6.6s |

So the contract effectively settles one write per ledger (~5s) regardless of how many distinct
senders there are. Every `send` writes shared state — the instance counter, and the escrow's own
token balance — so concurrent transactions collide at apply time.

**Impact today:** none of the user-facing flows depend on it any more. Invites come from the
pre-minted pool, and claims are naturally spread out in time as people open their links.

**Impact if traffic becomes genuinely concurrent** (a room full of people claiming at the same
moment, which Level 5's 50-user target makes plausible): claims would begin to fail. The fix is
to remove shared writes from the hot path — replace the global counter with a per-sender nonce
and derive statistics from events rather than from on-chain counters. Deliberately not done yet:
the mechanism deserves confirmation before a redesign, and the token-balance write may turn out
to be irreducible for any escrow that pools funds in one contract.

## Reproducing

```bash
cd web
node scripts/concurrency-probe.mjs 10   # ten people tapping at once, live
node scripts/loadtest.mjs 25            # contract stress, separate instance
```
