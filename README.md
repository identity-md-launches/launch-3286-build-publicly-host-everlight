# Everlight Garden

Static Vite + React + TypeScript site for the Everlight Garden on IMD. Install, preview and rebuild:

```sh
cd web
npm ci              # install the locked dependencies
npm run build       # tsc --noEmit + vite build, writes the static export to ../dist (relative ./ asset URLs)
npm run preview     # serve the built export locally
npx vitest run      # unit and regression tests (all mocked)
```

## Current revision (2026-11-21, revision 17): review findings on the burn dashboard. Read first

This is a website change only. Contracts, addresses, ABIs and economics are unchanged: 1 IMD per candle, split
30% burn / 60% previous paid candles / 5% operations / 5% founder, and the first-ever candle sends 90% to burn.
Nothing was deployed. No real-fund transaction was sent.

### Fixes (each one reproduced first in the mocked browser harness)
- **Final dispatch simulation** (`BurnPanel.tsx`, `confirm`): the last `simulateContract` before `writeContract`
  now has its result checked. If `dispatchBurn` returns `false` (a send failure the contract catches), the wallet is
  not asked and the job stays retryable.
- **Authenticated Base deliveries** (`lib/burn.ts` `authenticateDelivery`; `BurnPanel.tsx` `prepare` and `JobRow`):
  "Retry failed burn" and "Send burn confirmation to Ethereum" require the Ethereum `burnJobs` row, Base
  `jobGuids(jobId)` and `deliveries(guid)` to agree on job ID, amount and GUID. The row check runs on display, and
  fresh reads repeat it before the review and again before the wallet request. If a read is missing, the actions
  stay off.
- **Cross-tab wallet requests** (`lib/burn.ts` `holdOp`, `opHeld`, `settleHash`): a tab holds a Web Lock named after
  the operation for as long as its wallet request is open. "I checked my wallet: forget it" is refused in any tab
  while that lock is held. If the record was removed anyway, a late hash is saved again and other saved operations
  are left alone.
- **Mined reverts** (`BurnPanel.tsx` `follow`): receipts are now followed with the chain's viem public client. It
  returns a reverted receipt, where wagmi's action threw. A status-0 receipt is reported as a revert, and the
  operation is removed so retry is unlocked. A receipt that cannot be read yet still keeps the operation saved.
- **Review stays accurate** (`Review.key`): Confirm compares the fresh account, arguments, job number, reserved
  amount, dust, remaining balance and fee with the review. If any of them changed, the review is replaced and
  nothing is sent until the owner confirms again.
- **Tiny footer amounts** (`compactImd`): a positive balance never reads "0". It shows "0.000001", or
  "< 0.000001" below one bridge unit. The exact units are in the tooltip, and the dashboard adds a units suffix
  wherever 6 decimals would hide part of an amount.
- **Footer layout**: the counters wrap, and refresh with Burn details gets its own group. The strip grows taller on
  phones. The last-update line is always visible and links the Ethereum and Base snapshot blocks to their explorers.
  The strip's min-height (`--strip-min`) is now separate from the measured `--strip-h`, so the footer shrinks again
  when the window widens.
- **Recent confirmations** (`lib/burnio.ts`): log scans now run newest blocks first. `readReceiptSent` filters on
  the indexed `burnGuid` and reports the block range it covered. A pending confirmation links its `ReceiptSent`
  transaction (LayerZero Scan and Basescan) and shows the message GUID. Job cards show the full GUID, wrapped.
- **Dashboard lede** now gives the first-candle 90% exception.

### Checks run (revision 17)
| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npx tsc --noEmit` | no errors |
| Unit tests (all mocked) | `cd web && npx vitest run` | 20 files, 238 tests passed (8 new in `tests/revision17.test.ts`) |
| Production build | `cd web && npm run build` | built; `dist/` committed |
| Finding reproductions (MOCKED) | `PLAYWRIGHT_BROWSERS_PATH=… node evidence/rev17/burn-harness.mjs <repo> evidence/rev17 <playwright/index.mjs>` | 71/71 passed: `evidence/rev17/results.json`, screenshots in `evidence/rev17/screens/` |
| Purchase/claim regression (MOCKED) | `node evidence/rev15/browser-harness.mjs <repo> <out> <playwright>` against the new `dist/` | 68/68 passed: `evidence/rev17/regression-purchase-claim-results.json` |
| Design probe | `IMD_PLAYWRIGHT=… node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | all 16 checks passed: `evidence/rev17/taste-probe.json`. The 390 screenshot shows the garden and "Light a candle · 1 IMD" on the first screen |

**Mocked versus live.** Every row in `evidence/rev17/results.json` is mocked and the file says so (`"mocked": true`).
The harness serves the compiled `dist/` to real Chromium. Playwright route interception answers all Ethereum and
Base JSON-RPC with labelled fixtures, and a labelled EIP-6963 test wallet records each `eth_sendTransaction`
instead of sending it. The scenarios follow each finding's reproduction:
- dispatch simulations returning true, true, false: zero sends;
- jobGuids 0xcdcd… against an Ethereum GUID 0xabab…, for both a Failed and a Burned-unacknowledged delivery: zero
  sends, plus a matching control that does reach the wallet once;
- two tabs, with "forget" tried while tab A's wallet request is still open, then a late hash and a reload;
- a mined status-0 receipt, both live and after a reload;
- unqueued dropping from 5.4 to 2 IMD between review and confirm;
- 0.000001 IMD burned, then 0.000001 IMD pending;
- a Base RPC outage at 320 and 390px;
- the footer's last-update line and explorer links at 320, 390 and 1440px;
- widening the window from 901 to 1920px;
- a 1,000-block getLogs limit with a ReceiptSent one block below the head;
- the dashboard lede.

This round made no new live read-only check. The live figures in revision 16 below (5.4 IMD allocated and queued,
0 jobs, 0 burned) are the most recent ones.

**Better Interface review of this round's changes.**
- Layout: the footer controls and error text now stay inside the viewport at 320/390px (findings 3564d23a and
  6c1e729b).
- Accessibility: the status line stays `role="status"` and is visible rather than only in a tooltip (59d44d44).
  The disabled public actions state their reason in text.
- Writing: the plain lede states the 90% exception.
- Typography and colour: existing tokens only, and the probe's type-size, face and contrast checks pass.
- UI: a changed review needs a second explicit confirmation.

Limitations: rendered checks ran in headless Chromium only. There was no screen-reader run and no real wallet.

**Not tested**: real `queueBurn`, `dispatchBurn`, `retryBurn` or `sendBurnReceipt` transactions (no real funds, and
no live burn job exists), LayerZero delivery timing, and Web Lock behaviour in browsers other than Chromium.
Without Web Locks the forget guard only protects the tab that is signing. A late hash is still saved again.

## Current revision (2026-11-21, revision 16): burn dashboard and live footer counters. Read first

Website update only, using the deployed contracts: garden `0x33a514c5e2028f1affd70b82f170e8193df030a5`
(Ethereum) and burn receiver `0x4FdE47d5b574F9F18bC86D9878A460e6b1373D1E` (Base). Contract rules come from
launch-3312 at 5752e230 (`EverlightBridgeQueue.sol`, `EverlightBurnReceiver.sol`). The split is still 1 IMD per
candle: 30% burn / 60% previous paid candles / 5% operations / 5% founder, with 90% burn for the first-ever candle.
Nothing was deployed or sent; the only "transactions" in testing went to a mock wallet that rejects every request.

### What changed
- **Footer** (`BurnFooter`, `web/src/panels/BurnPanel.tsx`): "IMD burned" = Base `totalBurned`; "Pending burn" =
  Ethereum `totalBurnAllocated` minus Base `totalBurned`. A refresh button, last-update time, 60 s polling and a
  "Burn details" link to the shareable route `#/treasury/burn`.
- **Accounting** (`web/src/lib/burn.ts`, pure and unit-tested): each chain is read at one block (number +
  timestamp recorded, `web/src/lib/burnio.ts`). Checks inside each chain (allocated = queued + reserved + in
  transit + confirmed; failed ⊆ reserved; dust = queued mod 1e12; received = pending + burned; failed ⊆ pending)
  and across chains (burned ≤ allocated; confirmed ≤ burned; received ≤ dispatched). A cross-chain mismatch
  re-reads both chains up to 3 times; if they still disagree the figures read "Unavailable" and the last consistent
  snapshot is shown labelled stale. Negative values are never clamped. `confirmedBurn` is never added to
  `totalBurned`, and `burnInTransit` is never summed with Base `pendingBurn`.
- **Dashboard** (`#/treasury/burn`): Ethereum allocation, unqueued (`burnQueued`, with bridge dust), reserved
  (`burnReserved`, failed sends as a subset), dispatched/unacknowledged (`burnInTransit`, with the part already
  burned on Base), confirmed (`confirmedBurn`); Base received, pending, failed (subset) and burned. Jobs are read
  straight from the `burnJobs` mapping, newest first, 10 per page, with the Base `jobGuids`/`deliveries` cross-check.
  Transaction links come only from events matched to the job ID/GUID; when the bounded log scan cannot cover the
  range the page says the history is partial. `burnJobCount` is labelled as a historical count (the Treasury panel's
  old "In N burn job(s)" wording was corrected the same way).
- **Owner actions (Ethereum)**, only for the address `owner()` returns: "Prepare burn batch" (`queueBurn`) shows the
  exact rounded amount in token units, the rounded-off dust and the remaining balance; "Send batch to Base" /
  "Retry failed send" (`dispatchBurn`) uses `quoteBurn(jobId)` as the exact `msg.value`, re-quotes before the wallet
  is asked (stops if it changed), simulates (stops if the simulated send returns `false`), and sends at least
  1,500,000 gas so the contract's `SEND_GAS` headroom check passes. Success requires `BurnDispatched` for the job;
  `BurnSendFailed` in a successful receipt is reported as a failed send that can be retried.
- **Public actions (Base)**: "Retry failed burn" (`retryBurn`) only for Failed deliveries; "Send burn confirmation
  to Ethereum" (`sendBurnReceipt`, fee from `quoteReceipt(2, guid)`) only for Burned, unacknowledged deliveries. The
  page says the caller pays and gets no tokens or reward. `performBurn` is never offered. A sent but undelivered
  confirmation is shown as pending with a LayerZero Scan link; nothing is resent.
- **Transaction safety**: fresh account/chain/eligibility checks, simulation and a review of all costs before every
  wallet request; operations are saved in `localStorage` (`everlight:v1:burnops:…`) before signing, carry their hash
  after it, are shared across tabs (Web Locks + storage events; a conflicting operation in another tab is refused)
  and are followed after a reload. Replacements are followed through viem and judged by events. A wallet error that
  is not a rejection leaves the operation saved as uncertain; nothing is retried automatically.
- Wagmi now knows Base (8453) too. Purchases and claims still check `chainId === 1`; the header shows "On Base"
  rather than "Wrong network" on Base.

### Checks run in revision 16 (its `artifacts/rev16/` files were never committed because `artifacts/` is git-excluded in this workspace; current evidence is in `evidence/rev17/`, see revision 17 above)
| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npx tsc --noEmit` | no errors |
| Unit tests (all mocked) | `cd web && npx vitest run` | 19 files, 230 tests passed (28 new in `tests/burn.test.ts`; existing purchase/claim/recovery suites unchanged and passing) |
| Production build | `cd web && npm run build` | built, `dist/` committed |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | all 16 checks passed (`artifacts/rev16/taste-probe.json`) |
| Layout (headless Chromium, live read-only RPC) | `artifacts/rev16/shots.mjs` | 320/390/820/1280/1440, garden and burn route: no horizontal overflow, no console errors, zoom and minimap never overlap the strip (`layout-checks.json`, screenshots in `screens/`) |
| Wallet flows (mock EIP-1193 wallet, live read-only RPC) | `artifacts/rev16/wallet.mjs` | owner on Ethereum: Prepare enabled after an amount, review showed job #1, 5.4 IMD (5400000000000000000 units), 0 dust, gas estimate; Confirm sent one request to the mock wallet, which rejected it; page said "You rejected the request… Nothing was sent." and the saved operation was removed. Non-owner: no owner controls. Owner on Base: Prepare disabled with "Switch your wallet to Ethereum.", header "On Base" (`mock-wallet-checks.json`) |

**Mocked versus live.** Unit tests use fixtures only: accounting with a lagging RPC, retry until both chains agree,
giving up as Unavailable, RPC failure, staleness, bridge dust, fee ceilings, owner/public authorisation, wrong chain,
wallet rejection, `BurnSendFailed` inside a successful receipt (failed-send recovery), a Base retry that fails again,
already-sent and pending confirmations, replaced transactions, saved operations across reloads and duplicate tabs.
Live read-only verification (2026-11-21): Ethereum block 26461815: `totalBurnAllocated` 5.4 IMD, all of it
`burnQueued`, `burnJobCount` 0, `owner()` 0x48E4…6ec9, activated and base-ready; Base block 60268595: receiver
`totalBurned` 0, `pendingBurn` 0. The site shows 0 burned and 5.4 pending, consistent.

**Not tested** (no real funds, and no live job exists): a real `dispatchBurn`, `retryBurn` or `sendBurnReceipt`
transaction, the Base switch with a real wallet, and LayerZero delivery timing. Base event scans use public RPCs with
a bounded request budget, so very old Base history may be labelled partial.

### Better Interface review (six domains) of the new UI
- Accessibility: every control is a native button/link/input with a visible label; the amount input has a `<label>`
  and `aria-describedby` note; the review heading takes focus when it opens (`BurnPanel.tsx`, review `useEffect`);
  outcomes are `role="alert"`, the snapshot is `role="status"`; stale/inconsistent states are said in words, not
  only colour. Fixed during review: the review box opened off-screen on phones without focus.
- Layout: the footer was taller than `--strip-h` at 1280/1440 so the zoom control overlapped it (probe measured
  102px vs 76px). Fixed by measuring the strip (`ResizeObserver` in `BurnFooter`). No overflow at any width.
- Writing: plain labels ("IMD burned", "Pending burn", "Burn details"); each disabled action says why next to it.
- Typography: existing scale only; a monospace family for GUIDs was dropped to keep two families (probe passes).
- Colour: existing tokens; contrast probe passes on measured text.
- UI: two explicit steps (review, then wallet); costs shown before the wallet; no auto-signing or auto-resend.
- Limitations: no screen-reader run and no real-wallet run; rendered checks were made in headless Chromium only.

### Publication
The committed `dist/` is the delivery; the hosting plane publishes it under everlight.identitymd.eth / https://everlight.imd.site/.

## Current revision (2026-11-20, revision 15): read first

This round fixes the two unresolved transaction-state findings from the final review of job 959f20ae (reviewed commit `59aab81`, which was still the tip of `main` when this round started). Contracts, addresses, ABIs and economics are unchanged: 1 IMD per candle; 30% burn, 60% to earlier paid candles, 5% operations, 5% founder, and 90% burn for the first-ever candle. Sales stay closed: nothing was deployed or activated, and no real-fund transaction was sent.

Commands, run from `web/`:

| Command | Result |
|---|---|
| `npm ci` | installed from the committed lockfile (no dependency changes) |
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | 18 files, **202 tests passed** (190 earlier ones unchanged and passing, plus 12 new tests in `tests/revision15.test.ts`); log in `evidence/rev15/vitest.txt` |
| `npm run build` | `tsc --noEmit && vite build`, exported to `dist/` with relative `./` asset URLs |
| browser reproduction (real Chromium tabs, **mocked chain**) | **68/68 checks passed** at 390×844 and 1280×800 (`evidence/rev15/browser-cross-tab-results.json`, 390 screenshots in `evidence/rev15/screens/`, harness `evidence/rev15/browser-harness.mjs`) |
| taste probe (`taste.mjs --out test/scratch/taste`) | **16/16 passed** at 320, 390 and 1440 wide (`evidence/rev15/taste-probe.json`). The 390 screenshot shows the headline, "Light a candle · 1 IMD", the sales status and the garden with its Pepes on the first screen |

### Fix 1: an older claim's receipt overwrote a newer claim (`web/src/lib/claim.ts`)
- `createClaimBoard` / `claimBoard` (`web/src/lib/claim.ts:53`) replaces the panel-local step and `claimStepApplies` guard. For each account it tracks the **latest attempt**: the one most recently started, or explicitly checked, in this tab. This works whether the shown step is running or final. A new attempt becomes the latest when its ID is created, before any of its steps.
- Only the latest attempt's steps are shown. A late outcome from an older attempt never replaces the newer attempt's result, amount, receipt link or error. That covers the automatic wait, a manual Check again and cross-tab settlement. Its final outcome goes into the account's history instead. The Rewards panel shows that history as one line beside the current result ("An earlier claim also settled: 2 IMD claimed. View earlier claim").
- Cross-tab settlement (`claimBoard.reconcile`, run on every pending-store change) releases only the latest attempt's pending or uncertain step and keeps its link. The panel then drops exactly that run's lock and re-reads rewards. A released attempt's running steps cannot re-lock Claim. Steps are stored per account, so one account's claim never changes another account's display.
- An explicit check cannot take over while another claim of the account is still live (`begin` refuses).

### Fix 2: an approval settled in another tab stayed pending (`web/src/lib/purchase.ts`)
- **Own attempt ID.** Approval steps now carry the approval's own attempt ID, and the parent purchase is passed as their `run`. So `purchaseFlow.attempt()` is the approval's ID while it is shown, and so is the panel's run lock. `approve-pending` and `approve-unknown` also carry the approval's saved record (`tx`).
- **Reconciling known hashes.** The pending-store subscription (`purchase.ts:713`) now also reconciles known-hash `approve-pending` and `approve-unknown` steps. When that approval's record disappears in another tab:
  - the step becomes the new non-running `approve-settled` step, with its transaction link kept;
  - the matching run lock is released, and allowance and balances are re-read (`purchaseFlow.onSettled`);
  - the approval is **verified, never inferred**. Verification reads its receipt (following a replacement from the saved sender and nonce), the mined transaction (this account's exact `approve(garden, amount)` on IMD) and the live allowance (`approvalOutcome`, `purchase.ts:677`). The outcomes are: success (the "Approval confirmed; candle purchase not sent." box, with its receipt and allowance), reverted, cancelled or replaced, allowance unreadable or below the approved amount, and unresolved. Unresolved means the receipt is not readable yet; the panel then shows a **Check again** button and the form stays usable.
- **Delayed callbacks.** After a release, the run stops at its next await (`purchase.ts:877-888`). A delayed approval receipt or error from that run never steps, relocks the form or sends a purchase. The run's own receipt removal is marked with `purchaseFlow.settling` so it is not mistaken for a cross-tab settlement. That keeps the uninterrupted approval → purchase flow unchanged.
- **Ledger.** `purchaseFlow.report(attempt, step, account, run)` (`purchase.ts:599`) applies a step only for the latest run, again whether the shown step is running or final. A run whose attempt was released can show only that attempt's own final outcome, never a continuation. Late final outcomes of older runs go to `purchaseFlow.history()`. An explicit Check again or the reload recovery (`recoverBuy`, `recoverApproval`) makes its attempt the latest unless a live run is shown.
- A fresh explicit click is always required before a purchase is sent after a cross-tab recovery.

### Regression tests (`web/tests/revision15.test.ts`, all mocked)
1. The reviewer's claim sequence: A is resolved in tab B, B completes, then A's delayed receipt arrives. B stays the displayed result (state, amount and link), and A is kept in history.
2. The reviewer's approval sequence: a known-hash approval is settled in tab B while tab A's receipt read is delayed. Tab A releases the approval, verifies it (receipt and allowance), keeps the receipt link and frees the lock. The later explicit click buys once, without a second approval.
3. Delayed callbacks after recovery (success, RPC error, stale reports of the old run) neither send a purchase nor overwrite a newer running or completed attempt.
4. Isolation and recovery cases: account isolation, rejected signatures (4001), wallet or account change before sending, reverted claim and approval, unavailable RPC (claim `uncertain` stays saved; approval `approve-unknown` stays locked, then is verified when settled elsewhere), and cancellation/replacement. An unrelated record change does not release the approval (no confusion with the parent purchase ID).
5. Single-tab claim and the uninterrupted approval → purchase flow. Step order and attempt IDs are asserted. The existing reload-recovery and single-tab suites (revisions 7 to 14) pass unchanged.

### Browser reproduction (real tabs, mocked chain)
`evidence/rev15/browser-harness.mjs` runs the production `dist/` in headless Chromium:
- Two pages of one browser context act as two real tabs: they share `localStorage`, and storage events and Web Locks are real.
- Every JSON-RPC response is **mocked** by request interception, and receipt visibility is set per tab: tab A's receipt reads return `null` (delayed) while tab B's return the receipt.
- Wallet requests go to an injected EIP-6963 wallet named **"Labelled Mock Wallet"**. It answers the claim and approval sends with fixed hashes and rejects the purchase signature with 4001, so nothing is bought even in the mock.
- The mock reports sales as open only so that the approval step can be reached.

These are **not live-chain transaction tests**. Both reproductions passed at 390×844 and 1280×800:
- **Claim:** A is sent and its receipt delayed. Tab B opens and settles A, so tab A shows "settled in another tab" with A's link. Claim is enabled again. B completes with "Claimed 5 IMD". A's delayed receipt is then delivered to tab A, and the display still shows B's 5 IMD and B's link, with A's 2 IMD as history. Two sends in total.
- **Approval:** tab A shows "Approval sent. Waiting…" with Working… disabled. Tab B settles it, so tab A releases it while its own receipt read is still `null`. Tab A does **not** claim success; it shows the link and a Check again button, and the form offers "Light 1 candle" because the allowance re-read shows 1 IMD. A's delayed receipt then arrives: no relock, no purchase, no overwrite. Check again verifies the approval: "Approval confirmed; candle purchase not sent." with the receipt link and "Allowance now 1 IMD". An explicit click then reaches the wallet with exactly one `buyCandles` request. One approval in total.

### Better Interface review (six domains) of the changed UI
- Accessibility (`LightPanel.tsx:471`, `Panels.tsx:321`): the new approval box uses the existing `pending-box` with `role="status"` inside the `aria-live` steps region. Its "Check again" button is a real `<button>`, disabled and labelled "Checking…" while busy. The links have descriptive text ("View approval", "View earlier claim").
- Layout: it reuses `.pending-box` and `.pending-acts`, so there are no new layout rules. No horizontal overflow at 390 or 1280 in the browser run.
- Writing: each state says what happened, what was not done ("Nothing else was sent", "candle purchase not sent") and what to do next.
- Typography and colors: the existing `.fine` and body styles and existing tokens; no new sizes or colors.
- UI: the main button returns to an actionable label after release, never "Working…". No finding needed a further fix.
- Not measured: contrast ratios and screen-reader output.

### Publication
- The corrected source and the rebuilt `dist/` are committed together. `dist/` is the export the publisher pins and serves at https://everlight.imd.site/. This job does not run a publishing command (the platform publishes the committed export after the job).
- So "hosted assets match the corrected build" can only be checked after publication: compare the hosted `index.html` asset names with `dist/index.html` from this commit.
- Before publication, a fetch of https://everlight.imd.site/ was not part of these checks.

Limitations: the Web Lock and storage-event behaviour was exercised in one Chromium context with two pages, which is how real same-origin tabs share them, but not across separate browser processes. The mocked chain has a fixed block cadence and no reorgs.

## Current revision (2026-11-20, revision 14): read first

This round answers the 2 high findings from the review. Both reproduced and both are fixed; the answers are in `.imd-responses.json`. Commands, run from `web/`:

| Command | Result |
|---|---|
| `npm ci` | installed from the committed lockfile |
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | 17 files, **190 tests passed** (181 earlier, plus 9 new in `tests/revision14.test.ts`) |
| `npm run build` | `tsc --noEmit && vite build`, built in about 3.5 s, exported to `dist/` with relative `./` asset URLs |
| taste probe (`taste.mjs --out test/scratch/taste`, run with the machine's cached Playwright and Chromium 1246) | **16/16 passed** at 320, 390 and 1440 wide (`evidence/rev14/taste-probe.json`). The 390 screenshot still shows the headline, "Light a candle · 1 IMD", the sales status and the garden on the first screen |

All tests are **mocked**: labelled in-memory storage shared by simulated tabs, a mocked wallet (wagmi actions) and mocked RPC reads and receipts. No funds and no chain writes were used. The only live check this round was the probe's render of the export. No new frame-time measurements or Pepe activity recordings were made: the garden code did not change, so the evidence from the earlier rounds still describes it.

What changed:
- **Atomic compare-and-update across tabs** (finding 4307f4bf). `pendingStore.compareAndUpdate` runs the read, the expected-hash comparison and the write of one attempt as one critical section under a Web Lock named `everlight-attempt-<id>`, which every tab of the origin shares. Every writer of an existing attempt takes the same lock: `replace` (the wallet's sent hash), `reconcileSent` and `completeMeta` (metadata), `attachHash` (Match) and the post-broadcast fallback `keepSent`. A writer whose expected hash changed gets the current entry back and writes nothing, and its caller checks only that returned entry. `replace` never overwrites a real hash another tab already attached; purchases and claims then follow that entry. Without Web Locks (insecure contexts, very old browsers), an in-page queue serialises this tab's writers.
  - Control run: with a no-op lock, the reviewer's interleaving reproduces (`updated`/`updated`, H1 saved). With the lock, exactly one writer wins.
- **Pending claims released when settled elsewhere** (finding 45488fbe). The Rewards panel now reconciles `pending` steps as well as `uncertain` ones by attempt ID. When the saved attempt is gone, the panel shows "That claim was settled in another tab or by its receipt…" with the transaction link kept, re-reads rewards and releases that run's in-flight lock. The lock is now a per-run token, so a newer run's lock is never released by an old attempt. `claimStepApplies` guards the still-running wait callback: a step from a released attempt cannot re-lock Claim, and a step from an old attempt never overwrites a newer one.
  - The same rule now covers purchases: a `buy-pending` step whose attempt was settled in another tab shows the transaction link and releases that run's lock. A delayed running step from the released attempt cannot re-lock the form.
- **Tests** (`tests/revision14.test.ts`, all mocked): the reviewer's paused-`setItem` interleaving, B committing first (H2 kept), two Match commits racing, `replace` and `reconcileSent` against a hash attached elsewhere, the Web Lock name and mode, and a render of `RewardsPanel` as tab A at 390 wide. That render clicks Claim 2 IMD (hash 0xcc…, nonce 9, receipt never returned), lets tab B's `checkClaim` verify the receipt, and checks that tab A releases, keeps the link, re-reads rewards and starts a new claim. It also checks that the old wait's later timeout does not overwrite the new claim. With the panel's old uncertain-only condition put back, this render test fails.

Limitations: the claim render test uses one jsdom document. Tab B is the same module calling `checkClaim` on shared storage, and the store notification stands in for the browser's cross-tab `storage` event. Real Web Locks were not exercised across two real browser tabs; the test checks that `navigator.locks.request` is called with the attempt's lock name in exclusive mode.

## Current revision (2026-11-20, revision 13): read first

This round fixes the 11 high findings and 1 medium finding from the review. Each one is answered in `.imd-responses.json`. Commands, run from `web/`:

| Command | Result |
|---|---|
| `npm ci` | installed from the committed lockfile |
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | 16 files, **181 tests passed** (165 earlier, plus 16 new in `tests/revision13.test.ts`) |
| `npm run build` | `tsc --noEmit && vite build`, built in about 8 s, exported to `dist/` with relative `./` asset URLs |
| taste probe (`node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`) | **did not run**: Chromium could not start here (`libnspr4.so` is missing) |

All tests here are **mocked**: labelled in-memory storage shared by simulated tabs, mock wallets and mock RPC clients. None of them touches a chain, a wallet or real funds. **No live checks ran this round**: no browser screenshots, no measured frame times, no live RPC reads. The browser evidence and performance figures in `artifacts/rev12/` are from the previous build and do not show this round's sprites, landings or spring notch. Those visual changes are still unverified in a browser.

What changed:
- **Pending-transaction storage**: each attempt is saved under its own key, `everlight:v2:pending:<garden>:a:<attempt>`. Settling an attempt writes a tombstone and then removes that attempt's key. Compare-and-update re-checks the tombstone after it writes. Because of this, one tab's delayed cleanup can no longer erase another tab's newer attempt, and a delayed callback can no longer bring back a settled one. Lists saved by earlier builds are migrated.
- **Approvals**: a durable approval intent (account, chain 1, IMD token, garden spender, exact amount, preflight nonce and block) is saved before the wallet is asked. An ambiguous outcome such as 4900 keeps it saved, keeps the form locked and offers recovery. A proven rejection clears only that attempt.
- **Match**: compare-and-swap on the attempt ID and its placeholder hash. If the attempt was settled while the lookup ran, nothing is recreated.
- **Wallet binding**: the click captures a wallet-state revision and the connector. Any account, chain or connector change before the wallet request invalidates the click, even if the wallet was switched back. This applies to purchases and claims.
- **Allowance**: a purchase-only quote that finds a lower live allowance sends nothing. It shows the new allowance and asks for an explicit approve click.
- **My candles**: the pages are reconciled with `candleCountOf`, read at the same block. A short register is shown as incomplete, and Try again resumes from the first missing offset.
- **Rewards**: claim steps are tied to their attempt ID. A step is released when its attempt settles in any tab. Check again keeps the mined receipt link.
- **Garden**: original Pepe sprites, walkers and lantern carriers that follow the path, a notched spring rim, and shared landings between stacked candle beds.

## Current revision (2026-11-20, revision 12): read first

Website only: no contract, address, ABI or economics change, and nothing was sent on chain.

- **Transaction fixes** (`web/src/lib/purchase.ts`, `chain.ts`, `intent.ts`, `claim.ts`, `panels/LightPanel.tsx`, `panels/Panels.tsx`, `App.tsx`):
  1. an attempt without a returned hash is never released on nonce evidence (a wallet may broadcast at a higher or private nonce, then return 4900). It stays "may have been sent", with Check again, a chain search and hash recovery;
  2. every approval, purchase and claim attempt has a durable id. Receipts, rejections and delayed callbacks touch only their own attempt (compare-and-update, safe across tabs);
  3. the connector's live account and chain are re-read right before approve, buy and claim, and every request carries `account` and `chainId: 1`. A change sends nothing and needs a fresh click;
  4. persisted storage is authoritative; memory keeps only failed writes;
  5. after Match, the returned entry with the real hash is checked at once;
  6. the newest allowance read wins (never the max), and a reduced allowance asks for a fresh exact approval.
- **Living garden** (`web/src/garden/scenery.ts`, `ambient.ts`, `renderer.ts`, `Garden.tsx`, `motion.ts`): one stepped hillside with dry-stone contour walls, stairs where paths climb, moss and flowers on the copings, cascades where the river steps down, and a rounded stone-and-reed spring from which the stream widens. Candle slots and selection are unchanged. Small animated frogs (an original design made for this garden) read the paper, carry a lantern, roll in the grass, walk to trees and rest, dance, and hold a mint-light ritual circle. They are decorative only: never hit-tested, no chain activity. They pause off screen, in hidden tabs, under reduced motion, or with the new Still garden button.
- Test results, performance and browser evidence: `artifacts/rev12/validation.md`. Mocked tests and browser checks are listed separately; no live chain checks were run this revision.

Install, preview, rebuild:

```bash
cd web
npm ci              # install exactly the locked dependencies
npm run typecheck   # tsc --noEmit
npm test            # vitest, 230 mocked tests (revision 16)
npm run build       # writes the static export to ../dist (relative asset URLs)
npm run preview     # serve the built export locally
```

The committed `dist/` is what gets hosted. Add `?fixture=100` to the URL to see labelled fixture candles with payments disabled.

## Current revision (2026-11-20, revision 9): read first

Live site: https://everlight.imd.site/ (static export in `dist/`, pinned by the publishing plane). Contracts, ABIs, config, economics, candle IDs, wishes and records are unchanged: Ethereum garden `0x33a514c5e2028f1affd70b82f170e8193df030a5`, Base receiver `0x4FdE47d5b574F9F18bC86D9878A460e6b1373D1E`. Nothing was deployed, activated or spent.

This revision closes the final review's four findings and starts the garden visual rebuild:

1. **Purchase intents** (`web/src/lib/purchase.ts`, `web/src/lib/intent.ts`): an ambiguous wallet failure (4900/4901 disconnect, timeout, unknown) keeps the durable intent and locks the draft; only a proven 4001 rejection releases it. Intents resolve by account, chain, garden target, nonce and exact calldata; users can paste and validate a transaction hash, and a release needs explicit confirmation.
2. **Claims** (`web/src/lib/claim.ts`): storage preflight and an exclusive, read-back claim intent are saved before the wallet is asked; storage failure sends nothing; pending or uncertain claims lock Claim per account across reloads, networks and tabs.
3. **Counts** (`web/src/lib/counts.ts`): "N lit" is the contract's `totalCandles`; loaded records show separately as "loaded X of Y", incomplete data has Retry, and an unknown total reads "unavailable", never 0.
4. **Approval then re-plan**: "Approval confirmed; candle purchase not sent." with the approval link, the allowance read afterwards and the revised total; no second approval when the allowance already covers the revised purchase.

Garden: quiet dark ground, haze toward the skyline, wider river with natural banks and reflections, restrained amber glow. Open visual items are listed in `artifacts/rev9/validation.md`.

How it works, in short: 1 IMD per candle; 30% burn allocation, 60% shared among earlier paid candles, 5% operations, 5% founder, no ecosystem share; the first-ever candle sends 90% to the burn allocation. Rewards come only from later purchases and are claimed by hand: no guaranteed yield. Wishes are public, immutable plaintext on Ethereum (up to 280 characters / 1,120 bytes); the chain keeps them even if this website goes offline.

Install, preview, rebuild: `cd web && npm ci && npm run build` (typecheck + Vite build into `../dist`), `npm run preview` to serve the export, `npm test` for the 131 unit/regression tests. Results of this revision: `artifacts/rev9/validation.md` (commands, test counts, browser screenshots at 1600x1000 and 390x844, design-probe result, live read-only vs mock separation).

## Current revision (2026-11-19, revision 8 of job 12f1426d): read first

Revision 8 answers six review findings (answers in `.imd-responses.json`):
- **Purchase recovery intent before signing** (`web/src/lib/purchase.ts`, `web/src/lib/chain.ts`). Before the wallet is asked to sign, the page saves a recovery intent with the exact draft, the sender, the nonce and the submission block. The intent carries a placeholder hash of the same length, so saving the real hash later needs no extra space. If the intent cannot be saved, nothing is sent. After broadcast the intent is replaced by the sent hash in one write. If that write fails, the intent stays saved. A reload then keeps the form locked and resolves the purchase from the sender's nonce (`locateMined`) before another send is possible. The exact calldata and events are still checked against the saved draft. The one-character storage probe is gone.
- **Claims lock while a saved claim is pending** (`RewardsPanel` and `checkClaim` in `web/src/panels/Panels.tsx`). The Rewards panel subscribes to saved claims for the connected wallet on this garden. Claim stays disabled ("Waiting for the earlier claim") until the claim settles. The panel shows the pending claim link, Check again, and "Forget it: my wallet shows it was dropped".
- **Oversized contract gas estimates re-plan the batch** (`fittingPrefix` in `web/src/lib/split.ts`, `LightPanel.tsx`). If the contract's estimate for the next purchase is above 16,777,216 gas, or the RPC refuses it with a gas error such as "gas required exceeds allowance", the page searches for the largest ordered prefix that fits. It then re-plans the next purchase to that prefix and shows the new plan with its estimate. Nothing is sent until the visitor confirms again, and every wish is kept. RPC gas-cap errors are no longer reported as an IMD approval problem (`isGasCapError` in `web/src/lib/errors.ts`).
- **Register shows a known total while the first page is missing.** It shows "Showing 0 of 100 candles, loading the first page…" while the page loads. If the page fails, it shows "Showing 0 of 100 candles. The first page could not be loaded." with Try again. The garden canvas's accessible name uses the verified onchain total, or says the count could not be confirmed yet. It never says 0 for an unknown count.
- **Every terrace drawn raised is reachable** (`stairsOf` in `web/src/garden/scenery.ts`). A terrace whose flight could not be placed, or whose flight has no route to the path, is now drawn as a ground-level bed with a low stone kerb. Its unreachable flight is dropped. Across the 105 initial sectors that is 1,275 raised terraces, each with a connected flight, and 390 ground-level beds. The founding sector has 13 raised terraces, all connected, and 5 beds. Holder coordinates and candle IDs are unchanged.
- **Evidence is committed**: `evidence/rev8/rev8-browser-checks.json`, `evidence/rev8/rev8-taste-probe.json` and 32 screenshots `evidence/rev8/screens/rev8-{before,after}-*.jpg`.

Validation (worker-side, after the last source change):

| Check | Command | Result |
| --- | --- | --- |
| Install | `cd web && npm ci` | ok |
| Typecheck | `cd web && npx tsc --noEmit` | exit 0 |
| Unit tests | `cd web && npx vitest run` | 12 files, 119/119 passed (new `tests/revision8.test.ts`) |
| Build | `cd web && npm run build` | built `dist/` with relative `./` URLs |
| Browser | Playwright + Chromium headless shell, local static server, all non-local requests aborted | 26 passed, 0 failed (`evidence/rev8/rev8-browser-checks.json`) |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 passed (`evidence/rev8/rev8-taste-probe.json`) |

Every browser check used fixtures or blocked RPCs (**mocked**). No fork test and no live transaction ran. I did not check HTTPS or a fresh load of https://everlight.imd.site/ from here.

## Revision 7 notes (superseded where revision 8 differs)

This round fixes the reviewer's findings and, unlike the previous round, it was built with the real toolchain: `npm ci`, `tsc` and `vite build` all ran on this machine. The committed `dist/` is a normal `vite build` output, so the hand-spliced bundle from the previous round has been replaced.

What changed:
- **Large purchases are split, not blocked** (`web/src/lib/split.ts`, `web/src/panels/LightPanel.tsx`). The draft is divided, in order, into purchases of at most 50 candles. Each purchase's documented gas bound (300,000 + 170,000 per candle + 1,300 per wish byte) stays within the 16,777,216 gas cap for one transaction. The panel lists every purchase with its candles, IMD and gas. The button sends only the next purchase, and each one needs its own wallet confirmation. Before signing, each purchase is also estimated against the contract (`estimateContractGas`) and sent with that estimate plus 20%, capped at 16,777,216. Once a purchase is confirmed, exactly its candles are removed from the front of the saved draft. Everything not yet sent stays in the form, including after a reload.
- **Water animates on its own clock** (`web/src/garden/motion.ts`, `Garden.tsx`). It runs at 20 fps whenever a stream is on screen, with zero candles and at any zoom where water is drawn. Flames run at 30 fps. Nothing animates in a hidden tab or with reduced motion. On phones the opening view now includes the nearest stream (`renderer.ts` `home()`).
- **A storage failure can no longer unlock a sent purchase** (`web/src/lib/purchase.ts`). Before the wallet is asked to sign, the page checks that it can save recovery data. A sent hash is held in memory before it is saved. Any failure after broadcast becomes `buy-unknown`: the draft stays locked and the receipt keeps being tracked.
- **The candle register no longer treats an unknown count as zero** (`Register` in `web/src/panels/Panels.tsx`). It shows "Reading…" while loading, "Unavailable" with Try again when the RPC fails, and "Showing N of M" when only part of the list has loaded. "No candle has been lit yet" appears only after the total has been read as 0.
- **Terraces connect to the paths** (`web/src/garden/scenery.ts`, `stairsOf` + `connect`). Steps are placed on more terrace ends. Flights whose feet land on the path count as joined. Walks can be longer, two-leg (L-shaped), or run to the foot of a neighbouring terrace that is already connected. Walks keep off holders, water and other terraces' lawns. Across the 105 initial sectors, 1,410 of 1,665 raised terraces now have a flight (previously 401) and 1,275 are connected to the path (previously 171 direct walks). The founding sector has 16 of 18 terraces with steps, 13 of them connected. Candle positions are unchanged.
- **Primary button contrast**: ivory on `#2a5233` (7.17:1), with hover `#356a3f` (5.13:1) (`web/src/pixel.css`).
- **ABI**: `RewardAllocated`'s last field is now named `fallbackToBurn`. The pinned `docs/abi/WishGarden.json` (raw file, HTTP 200) was compared entry by entry with `web/src/abi/WishGarden.ts`. There are no other differences, and the receiver ABI matches exactly.

Validation (worker-side, after the last source change):

| Check | Command | Result |
| --- | --- | --- |
| Install | `cd web && npm ci` | ok |
| Typecheck | `cd web && npx tsc --noEmit` | exit 0 |
| Unit tests | `cd web && npx vitest run` | 11 files, 112/112 passed (new `tests/revision7.test.ts`: split plan, draft consumption, motion gate and cap, storage failure before and after broadcast, unknown count, terrace connectivity, ABI field) |
| Build | `cd web && npm run build` | built `dist/` with relative `./` URLs |
| Browser | Playwright + Chromium headless shell (software GL), local static server | revision 7's raw log and screenshots were never committed; see revision 8's evidence above |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 passed (revision 7's report was not committed; see `evidence/rev8/rev8-taste-probe.json`) |

Every browser check used fixtures or blocked RPCs (**mocked**). No fork test and no live transaction ran. I did not check HTTPS or a fresh load of https://everlight.imd.site/ from here.

## Revision 6 status (read first)

The live integration now targets the revised garden `0x33a514c5e2028f1affd70b82f170e8193df030a5` and the Base receiver `0x4FdE47d5b574F9F18bC86D9878A460e6b1373D1E`. The split is 30% burn, 60% earlier candles, 5% operations, 5% founder, and ecosystem 0%.

The committed `dist/` for this revision was patched from the edited source because this machine had no network access for `npm ci`. `npm run build` and `npm run typecheck` were **not** run for this revision. See `artifacts/validation.md` (Revision 6) for exactly what ran and what did not.

Install, preview and rebuild:

```sh
cd web
npm ci              # install the locked dependencies
npm run typecheck   # tsc --noEmit
npm test            # vitest unit tests
npm run build       # typecheck + vite build into ../dist (relative asset URLs, base ./)
npm run preview     # serve the built export locally
```

Open `?fixture=0|100|3000|10000` for labelled test fixtures with transactions disabled.

# Everlight Garden

**Current revision (2026-11-19): 16-bit pixel-art garden.** See `DESIGN.md` (top section) and `artifacts/validation.md` (top section).

## Install, preview, rebuild
```
cd web
npm ci                              # install from package-lock.json
node art-src/pixel/build.mjs        # (optional) regenerate pixel assets into public/art/px
npm run build                       # tsc --noEmit + vite build -> ../dist (relative ./ URLs)
npm run preview                     # serve the export locally
npx vitest run                      # unit tests
```
The committed `dist/` is the static export the host serves; it has no backend.

## Results of this revision
`tsc --noEmit` exit 0; `vitest` 90/90 passed; `npm run build` ok. **The browser walkthrough and design probe
did not run.** Headless Chromium on the build machine crashed the garden tab. That is an open, undiagnosed
defect, so this revision has no screenshots or performance numbers. Details: `artifacts/validation.md`.

---

# Everlight Garden

A wallet-connected static website for the **existing** Everlight Garden contracts. It renders a midnight garden in which every paid candle permanently lights its own position. Visitors can browse, search and read candles without a wallet. Holders can light candles with IMD on Ethereum, list their candles, claim rewards and inspect the treasury and the cross-chain burn stages.

This repository contains only a website. It deploys no contract, token or NFT, and it never sends owner transactions.

## Contracts (read from the pinned source)

Source of truth: `identity-md-launches/launch-3281-everlightgarden-everlighttreasury-everli` at commit `f3ae2915b2fc99c56079da2fc9addef2e94397e0`. The full inherited ABI (`WishGarden → EverlightBridgeQueue → WishGardenTreasury → GardenEconomy`, Ownable2Step, ReentrancyGuard) is in `web/src/abi/WishGarden.ts`, exported from that commit's `docs/abi/WishGarden.json`. The Base receiver ABI is in `web/src/abi/EverlightBurnReceiver.ts`.

| Role | Chain | Address |
| --- | --- | --- |
| Garden and treasury | Ethereum (1) | `0x39e55288f5b84dd867a784c95f110818ea8f3b31` |
| IMD | Ethereum (1) | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| Burn receiver | Base (8453) | `0xb525358f3f1c531522a27092e8aa1c054bb963fc` |
| IMD | Base (8453) | `0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105` |
| Owner | | `0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9` |

Live state read on 2026-11-17 at block 26,433,432: `activated = false`, `purchasesPaused = true`, `totalCandles = 0`, `baseReady = true`, `owner` matches. The site reads these flags live. While sales are closed, purchasing is disabled with an explanation, and reads and claims stay available.

## Layout

```
web/                 Vite + React + TypeScript source (package.json, package-lock.json)
  src/config.ts      addresses, chains, public RPC failover, wagmi config
  src/abi/           ABIs from the pinned commit
  src/garden/        deterministic layout, canvas renderer, garden component
  src/lib/           candle store (paged reads + cache), purchase state machine, wish limits, errors
  src/panels/        Light a candle, My candles, Rewards, Treasury, How it works, candle details
  src/components/    wallet connect sheet (EIP-6963 + Coinbase + open-in-wallet links)
  src/garden/layout.ts   continuous landscape geometry: winding streams/paths, curved terraces, slot positions, hit test
  src/garden/scenery.ts  procedural sector scenery (terraces, stream, pools, waterfall, bridge, pedestals)
  art-src/           procedural painter (paint.js) and WebP generator (generate.mjs) for every scenery asset
  public/art/        generated WebP scenery layers and sprites, seven candle styles (CC0, see LICENSE.md there)
  tests/             vitest unit tests (labelled mocks and fixtures)
dist/                committed production export (relative URLs, base "./")
DESIGN.md            implemented design system
artifacts/validation.md  checks run, results and limitations
artifacts/asset-manifest.md  every asset, its layer and its provenance
artifacts/screens/   browser screenshots (1440 / 390, fixtures, live) and reference side-by-sides
artifacts/recordings/ desktop and mobile walkthrough recordings (WebM)
```

## Install, preview, rebuild

Requires Node 20+ (built with Node 24.21, npm 11.19).

```sh
cd web
npm ci                 # install exact locked dependencies
npm run dev            # local dev server
npm run typecheck      # tsc --noEmit
npm test               # vitest: wish limits, quantity 1-50, paging, layout, purchase flow on mocks, escaping
npm run build          # typecheck + vite build into ../dist (emptied first)
npm run preview        # serve the built export locally
```

`dist/` is a static export. Serve it from any static host, IPFS gateway subpath or ENS name; all asset URLs are relative, and pages use hash routes (`#/light`, `#/mine`, `#/rewards`, `#/treasury`, `#/how`).

### Regenerate the artwork

The scenery is original procedural artwork: no image-generation model or illustration tool was available for this job (an unresolved blocker; see `artifacts/validation.md`). The vista is drawn at runtime by `web/src/garden/vista.ts`. To repaint the sprite assets:

```sh
npm i --prefix /tmp/art @napi-rs/canvas
CANVAS_MODULE=/tmp/art/node_modules/@napi-rs/canvas/index.js node web/art-src/generate.mjs   # writes web/public/art/*.webp
cd web && npm run build
```

### Test fixtures (no chain writes)

- `?fixture=0`, `?fixture=100`, `?fixture=3000`, `?fixture=10000` replace live candles with a deterministic local fixture, shown with a "Test fixture … not onchain" label. The fixture includes HTML/script wishes, RTL, CJK, emoji and 280-character wishes to exercise escaping and layout.
- `?noassets=1` points the art loader at a missing folder to exercise the drawn fallbacks.

## How it works

- **Reads**: `totalCandles`, then `getCandles(firstId, ≤100)` page by page. Only new ids are fetched on each 30-second refresh. Records are cached in `localStorage` and each page streams into the garden as it arrives. `candleIdsOf(owner, offset, 100)` pages My Candles. Status, rewards and treasury use Multicall3 through viem's `fallback` transport over four keyless Ethereum RPCs and three Base RPCs. Treasury events use bounded `getLogs` windows of 5,000 blocks, at most 8 windows, never before the deployment block 26,433,359.
- **Purchase**: check live sales flags, balance, allowance and ETH. Approve exactly `quantity × 1 IMD` if the allowance is short, wait for that receipt, simulate `buyCandles(styles, wishes)`, then request the purchase. Candles appear only after a successful receipt. Pending hashes are saved in `localStorage` and re-attached after a reload. A ref guard blocks duplicate clicks.
- **Wishes**: optional, public and immutable. The client enforces both 280 Unicode code points and 1120 UTF-8 bytes, and rejects lone surrogates, mirroring `Utf8Wish.validate`. A privacy acknowledgement is required before any wish is sent. Wishes render as React text nodes, never as HTML.
- **Gas**: the estimate uses the contract docs' bound `300,000 + 170,000 × candles + 1,300 × wish bytes`, times the live gas price (plus about 60,000 gas for an approval). A draft whose bound exceeds the EIP-7825 cap of 16,777,216 gas is split into ordered purchases that each fit, confirmed one by one; each is also estimated against the contract before signing.
- **Scene layers (one world)**: a procedural distant vista (`vista.ts`: sky, moon, ridges, castle), the only parallax layer, seated on the world skyline. Below it, one world-aligned ground fill, then grid cells drawn back to front by row: garden cells (terraces, stone holders, gazebo, lanterns, frogs) and wild woodland cells that continue the same streams, paths, pools and bridges. Each row's purchased candles and their additive light are drawn after that row's cells, from contract data only, so nearer scenery occludes them. Then comes the UI. Nothing scenic is fixed to the screen. At zero purchases every pedestal is empty and nothing is lit except the fixed decorative castle windows and lanterns. Those are boxed and steady, never flames.
- **Garden**: one canvas and one camera showing one continuous landscape (camera bounds, Reset view, a world minimap): winding streams and paths that run through every sector, and curved terraces with seeded, irregular arcs. Positions are deterministic per candle id; sectors of 96 holders grow in half-rings south of the home row, with no cap. It uses viewport culling and three LODs: cached low-resolution sector art with cached per-sector light layers, sprites, and sprites with animated flames. Empty stone holders mark unsold places. Zoom, pan, pinch, keyboard, minimap, find by id, My candles rings and a paged candle register keep every candle reachable.

## Licenses

- Source code: MIT.
- Art in `web/public/art/`, `web/public/favicon.svg` and `web/public/og.png`: original work for this site, CC0 1.0. The scenery is procedurally painted by `web/art-src/paint.js`, and the provenance is in `artifacts/asset-manifest.md` (copied to `web/public/art/LICENSE.md`). `og.png` is a screenshot of the export.
- Wallet marks in `web/src/components/walletIcons.ts`: the vendors' marks, as shipped by RainbowKit 2.2.11 (MIT), used only to identify each wallet.
- Fonts: none bundled. The site uses system serif and sans stacks.
- npm dependencies keep their own licenses (React, wagmi, viem, TanStack Query: MIT).

## Validation

These are worker-side results from 2026-11-18. The full record is in `artifacts/validation.md`.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 7 files, 86/86 passed (revision 5) |
| `npm run build` | built into `dist/` |
| design-critic probe `taste.mjs` | 16/16 checks passed at 320/390/1440 |
| Playwright walkthrough of the export (live reads plus `?fixture=0/100/3000/10000`, 1440 and 390 wide) | zoom/pan/bounds/reset, Find and the anchored popup, quantity edge cases, draft kept after reload, all routes, map tools hidden behind sheets; frame times measured headless (`artifacts/walkthrough-results.json`) |

| Revision 2 reproduction script (`test/scratch`, not shipped) on the export | the reviewer's steps, before and after: path/stream joins at overview and after a pan, spring heads, popup after Find 9876 and pans, maximum zoom, mobile Find 37, idle frame rate at 100 and 10,000 (see `artifacts/validation.md`, "Revision 2") |

Evidence: `artifacts/screens/` (revision 2 shots are `rev2-*.jpg`) (screenshots and reference side-by-sides) and `artifacts/recordings/` (desktop and mobile walkthrough WebM).

### Revision 3 (2026-11-18): review findings

Commands, run in `web/` after the last source change: `npx tsc --noEmit` exit 0; `npx vitest run` 6 files, 63/63 passed (adds replacement, receipt-verification and reload-recovery tests and `tests/receipt.test.ts` with ABI-encoded logs); `npm run build` built into `dist/`; design-critic `taste.mjs` 16/16 passed at 320/390/1440.

Browser reproduction (headless Chromium, `test/scratch`, not shipped; results in `artifacts/revision-findings-results.json`). The export was served by route interception; purchases ran against a **labelled mock JSON-RPC and an injected EIP-6963 test wallet**, not a chain, fork or real funds.

| Finding | Result after the fix |
| --- | --- |
| Split sheet vs zoom tools, 390×844 touch, `?fixture=100` | with the sheet open the map tools are hidden; `elementFromPoint` at three points of each of the five rows (Founder at y=734.5–760) returns the split list; tools return when it closes |
| Replacement without a purchase (B = 0xc3…, zero-value self-transfer, no logs) | stays on Light a candle with "cancelled or replaced" error; wish and quantity kept; no pending hash |
| Sped-up purchase (B carries the garden `CandlesPurchased` for 1–3) | candles 1–3 link to B, not the sent hash A; draft cleared |
| Reload while A has no receipt | draft locked (`fieldset disabled`), action disabled, pending link shown; a forced click sends nothing (1 `buyCandles` call in total); when B is mined the toast links B, the draft clears and the form unlocks |
| Find 37 at 390×844 and 768×844, Find 31 at 390×568 | ring 159–255 px vs sheet top 376 px; at 390×568 ring 113–200 px vs sheet top 274 px; all clear of the header |
| Desktop popup after Find 9876 and the reviewer's drags | hidden at ring y=16 and y=−84 (no detached box), visible again beside the flame when it returns (y=316) |
| Bridge at z=1.8 | the flagstone deck now spans the stream along the path and meets both approaches; the sprite's deck line sits on the walk's front edge and the stream shows only through the arches (screenshot checked by eye) |

**Limitations.** The art is procedural, not illustrated: no image-generation tool was available. It is not claimed to match the reference, and no similarity score was measured. No fork test or real wallet transaction ran; purchase, approval rejection, replacement and recovery are covered by unit tests and a browser harness on labelled mocks only, so live purchasing is not claimed. Approval rejection was not re-run in the browser in this revision. Hosting is done by the publishing plane from the committed `dist/`.

### Revision 4 (2026-11-18): approved design and verification fixes

What changed:
- **Layout from the approved design**: header with Garden / My Candles / Rewards / Treasury / How it works and an outlined gold Connect wallet; the headline "A wish, a flame, a place forever" with one plain line; at 1180 px and wider the **Light your candle** form is docked on the right (live candle preview with a CSS flame, seven equal-price styles in one row, wish, public-and-permanent note, quantity 1/5/10/Custom within 1–50, Total, the approval → purchase → verified-receipt stages, "Ethereum · gas paid separately", cost details). Narrower screens open the same form as a sheet. The candle popup leads with the wish (as text, never HTML).
- **Vista repainted** (`web/src/garden/vista.ts`): one castle on its own hill, drawn once (wide screens no longer repeat it), no black rectangle under it, no painted candle-like lights on far terraces (only data-driven candles are lit), moon placed under the header, moonlit empty stone terraces and a waterfall.
- **Replacement purchases** are verified against the exact signed draft: the mined (possibly replacement) transaction must be `buyCandles` from the buyer with identical styles and wishes, and the garden's `CandlesPurchased` and `CandleCreated` events must match quantity, ids, styles and wishes (`web/src/lib/purchase.ts`, `web/src/lib/receipt.ts`).
- **Bounded recovery after reload**: each sent purchase/claim saves sender, nonce and the submission block with its draft; after a reload `web/src/lib/recovery.ts` finds the transaction that consumed that nonce (binary search on historical nonces, falling back to a linear scan of at most 600 blocks) and verifies its receipt and events.
- **Claims**: shown as Claimed only when the mined transaction is this account's `claimRewards()` to the garden and the garden emitted `RewardsClaimed` for it; a cancel or self-transfer never shows Claimed (`settleClaim`).
- **Wrong network**: a Switch to Ethereum control beside each disabled action (`web/src/components/WrongNetwork.tsx`) and a header menu with Switch and Disconnect.
- **Mobile**: the candle sheet sits above the strip (measured: no overlap at 390×844); no horizontal overflow at 320.
- Share image `og.png` regenerated from the empty (fixture 0) garden: no invented candles.

Validation (worker-side, after the last source change): `npx tsc --noEmit` exit 0; `npx vitest run` 7 files, 78/78 passed; `npm run build` built `dist/`; design-critic `taste.mjs` 16/16 passed at 320/390/1440 (`artifacts/taste-probe.json`). Playwright evidence for fixtures 0/100/3000/10000, every page, live reads, load/heap/fps/latency and pan-zoom-select recordings: `artifacts/rev4-evidence.json`, `artifacts/screens/rev4-*`, `artifacts/recordings/rev4-*`; details and environment names in `artifacts/validation.md` ("Revision 4").

**Limitations.** No image-generation, illustration or 3D tool was available to this worker, so the painted, cinematic perspective garden of the approved design was **not** reproduced: the garden is still the procedural top-down terraced map with a repainted parallax vista, and no licensed illustrated environment assets were added. Frame rates were measured in headless software rendering, not on real devices. Purchases, replacements and claims are tested on labelled mocks only; no fork or live transaction ran.

### Revision 5 (2026-11-18): review findings

What changed (source references are in `artifacts/validation.md`, "Revision 5"):
- **10,000 empty holders from the start**: `sectorCount()` (`web/src/garden/layout.ts`) never drops below `MIN_SECTORS` = 105 sectors × 96 = 10,080 positions, so scenery, minimap, camera bounds and hit testing cover every holder before any purchase. Holders stay unlit until a confirmed record fills them; past 10,080 the garden still grows one sector ahead. This is visual capacity only; the contract's supply rules are unchanged.
- **Candle details only over the garden**: navigating to another page closes the selection; Find, the register and My Candles focus actions return to `#/garden` first; on phones a canvas tap uses the same framing as Find, so the sheet never covers the candle (`web/src/App.tsx`).
- **Header**: the tabs stay in the menu up to 1279 px and use tighter padding from 1280 to 1439 px; at 360 px and below the header uses 8 px gaps, a fixed 44 px menu button, and "Wrong network" wraps to two lines inside 80 px.
- **Fixtures are read-only**: a persistent "Test fixture … transactions disabled" label on every fixture page; purchase, approval and claim handlers refuse to run (`readOnly` in `runPurchase`, plus guards in `LightPanel` and `RewardsPanel`).
- **Exact verification**: a purchase is settled only once the mined transaction itself has been read. Its sender, the garden as target, the exact `buyCandles` styles and wishes, and the matching events all have to check out. If that transaction can't be read, the purchase stays pending and the draft stays locked, and verification can be retried. A successful replacement that bought different candles is reported as such, with its hash and ids. It is never described as a no-spend cancellation.
- **Recovery metadata**: the nonce and submission block are read before the wallet signs. If that read fails, nothing is sent. The preflight nonce is then reconciled with the sent transaction (read by its hash) and saved. Recovery after a reload re-reads it, and estimates a bounded block for older entries that lack one. Claims follow the same steps, and a claim whose transaction can't be read stays saved without being shown as Claimed.
- **Ignition**: once a purchase receipt and its events are verified (live or after a reload), the garden focuses the first new candle. Each new candle then lights once, from unlit wax through a spark, a growing flame and a bloom, to a steady glow (`web/src/garden/ignite.ts`, `renderer.ts`). Under reduced motion it appears already lit. Fixture loading and cached records never trigger the animation.
- **Hit testing** covers each candle's whole holder-to-flame-tip segment with a minimum touch radius of 22 CSS px, and the closest candle wins, so tapping the founding candle's flame selects it.
- **Share card** `og.png` is a 1200×630 card made from the empty garden plus the wordmark and one line of description. It has no controls and no live status or counts.

Validation (worker-side, after the last source change): `npx tsc --noEmit` exit 0; `npx vitest run` 7 files, 86/86 passed; `npm run build` built `dist/`; design-critic `taste.mjs` 16/16 passed at 320/390/1440 (`artifacts/taste-probe.json`); a Playwright check of the export ran 20/20 checks in Chromium headless shell 159 (`artifacts/rev5-browser-checks.json`, screenshots `artifacts/screens/rev5-*.jpg`). That browser check used a labelled mock EIP-6963 wallet that rejects any send; no transaction ran.

**Limitations (revision 5).** The garden art is unchanged apart from the larger cultivated area. No image-generation, illustration or 3D tool was available, so the approved painted perspective artwork and licensed detailed stone/brass/wax/foliage assets were still not produced. The garden remains the procedural terraced map with a parallax vista, and the purchase preview is unchanged. The ignition check in the browser uses a fixture-only test hook (`window.__igniteForTest`), not a real purchase.

### Revision 6 (2026-11-18): review findings

What changed:
- **Replacement recovery uses only a verified nonce** (finding 139cd715, `web/src/lib/chain.ts`). The saved sender and nonce drive the bounded replacement search only when `verifiedMeta(tx)` holds: `nonceChecked` is true because they were read from the submitted transaction itself, by its hash. A preflight nonce that was never confirmed is not searched by. Only the sent hash's own receipt counts, which viem's `waitForTransactionReceipt` follows to a replacement only after it has read the sent transaction. If that never arrives, `settleReceipt` throws `NONCE_UNVERIFIED`. The purchase then stays `buy-unknown`, its hash, exact draft and submission block stay saved, the form stays locked, and "Check again" retries. Claims recovered after a reload go through the same `settleReceipt`, so an unrelated transaction can never mark them Claimed or settle them. Live claims already use `waitForTransactionReceipt` on their own hash.
- **Purchase preview set** (`web/src/panels/PreviewScene.tsx`). This replaces the flat plate under the candle. It has a moonlit back layer with foliage, jasmine, faint pavilion arches, a moon and a carved stone ledge in perspective. The engraved brass bowl is drawn in two layers, so the candle sits inside it.
- **Water** (`web/src/garden/scenery.ts`): lit shallows over a darker channel, bank reflections, a wet-stone waterline, silver glints, ripple rings and lily pads, some flowering. These are still world-space curves, so cells join without seams.

Validation (worker-side, after the last source change): `npx tsc --noEmit` exit 0; `npx vitest run` 8 files, 90/90 passed. That includes the new `web/tests/nonce.test.ts`, which reproduces the reviewer's scenario with the real chain, recovery and purchase modules and only the Ethereum client's reads mocked. Against the previous `chain.ts` it fails with the reported result (`REPLACED_MESSAGE`, pending list emptied). With the fix it returns `buy-unknown` / `NONCE_UNVERIFIED` and keeps A saved. Further results: `npm run build` built `dist/`; design-critic `taste.mjs` 16/16 passed (`artifacts/taste-probe.json`); a Playwright pass over the export at 1440×900 and 390×844 in Chromium headless shell 159 had no console or page errors and no horizontal overflow (screenshots `artifacts/screens/rev6-*`). All of this is labelled mock or fixture evidence; no fork or live transaction ran.

**Limitations (revision 6).** No image-generation, illustration or 3D tool was available to this worker. The painted, cinematic perspective environment of the approved design is therefore still not produced. That means no large carved foreground steps receding to one castle valley, and no licensed illustrated stone, brass, foliage or pavilion assets. The garden remains the procedural terraced map with a parallax vista, and its trees still come from three sprites. The revision improves the preview and the water only. Closing the gap needs a worker with image or 3D tools, or illustrated layers from the requester. The renderer accepts replacements under the same sprite names in `web/public/art/`, and the vista through `makeVista()`.

### Revision 7 (2026-11-19): review findings

What changed:
- **Treasury Recent activity has Retry** (`web/src/panels/Panels.tsx:306-310`): a failed bounded `getLogs` scan shows the same alert and "Try again" link as the balance block (`role="alert"`, disabled and reading "Retrying…" while it runs). Balances are unaffected.
- **No false "none yet"** (`web/src/hooks.ts:153-166`, `Panels.tsx:311-317`): the scan is `complete` only when it reached the garden's deployment block. "No purchases, claims or burn jobs yet." appears only then. Otherwise an empty scan says "No activity in the last 40,000 blocks (since block N). Older blocks were not scanned here" and links to the full event history on Etherscan.
- **Collapsible purchase dock** (`web/src/App.tsx:136-149, 327-338`, `web/src/everlight.css:139-145`): at 1180 px and wider the docked Light your candle panel has a "Hide the candle panel" button (the site's `.x panel-x`). While hidden, a slim primary "Light a candle" tab sits at the right edge and the garden uses the full width. Focus moves between the two controls, and `#/light` always reopens the dock. The garden view is not reset.
- **Moon in open sky** (`web/src/garden/vista.ts:20-30, 92-101`, `web/src/garden/renderer.ts:226-276`): the moon is now its own sprite. It is placed upper left of the castle, below the header and clear of the headline and the castle keep. At 1180 px the headline leaves no room there, so it moves to the right of the castle.
- **Copy**: the headline is now "Every wish leaves a light." (the reference's line, `App.tsx:290`), and the brand reads "Everlight Garden on IMD" with no middle dot (`App.tsx:255`).

Validation (worker-side, after the last source change): `npm run build` (runs `tsc --noEmit`) exit 0 and built `dist/`; `npx vitest run` 8 files, 90/90 passed. Design-critic `taste.mjs` passed 16/16 at 320/390/1440 (`artifacts/taste-probe.json`). The 390 screenshot shows the moon, the headline and "Light a candle · 1 IMD" on the first screen. A Playwright pass in Chromium headless shell (software rendering, system libraries unpacked into a temp directory) ran 21/21 checks with no page errors (revision 7's raw log and screenshots were not committed; see revision 8). Those checks covered the brand and headline at 390 and 1440, horizontal overflow, dock hide and show with focus, reopening via `#/light`, Treasury with getLogs forced to HTTP 403 (Try again shown, recovery after clicking), the partial-range message, and the complete-range message. The getLogs and blockNumber responses in that Treasury check were **mocked** by request interception; no live RPC failure was waited for and no transaction ran.

**Limitations (revision 7).** The moon placement was checked at 320, 390, 1180, 1440 and 1920 at the opening view only, not at every zoom level. The Etherscan event link is the fallback for history older than the 40,000-block window; the site does not page further back itself. The art limits recorded for revision 6 still apply.


### Earlier round also labelled "revision 8" (historic, before this job's revision 8)

`npm run build` exit 0; `npx vitest run` 10 files, 102/102 passed; taste.mjs 16/16 passed. Playwright checks of the local export, using fixtures and a mocked RPC, were run. Their raw file was written to `artifacts/` and never committed, because `artifacts/` is excluded from Git in this checkout. This job's revision 8 evidence in `evidence/rev8/` replaces it. They covered:

- Treasury range narrowing, the stale and unavailable states, and Try again
- Find #37 and #10000 at 1440 and 390
- The menu reopening the dock
- Before/after opening-view screenshots

Wallet actions remain untested.

## Revision 10 checks

Run from `web/`: `npm ci`, `npx tsc --noEmit` (exit 0), `npx vitest run` (13 files, 134 tests passed), `npm run build` (writes `../dist`). The browser walkthrough (1600x1000 and 390x844, fixtures 0/100/3000/10000, Find, pan/zoom, water, reduced motion, all pages) and the design probe (16/16 passed) are recorded in `artifacts/rev10/validation.md`, with screenshots in `artifacts/rev10/screens/`. To regenerate the pixel art: `cd web && node art-src/pixel/build.mjs`.
