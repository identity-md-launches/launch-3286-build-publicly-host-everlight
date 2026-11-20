// MOCKED browser reproduction of the two cross-tab findings. Real Chromium tabs (two pages of one context, so they
// share localStorage and storage events like two real tabs), the production export from dist/, a labelled mock
// JSON-RPC (route interception, per-tab receipt visibility) and an injected labelled EIP-6963 test wallet.
// Nothing here talks to a chain, a wallet or real funds. Usage: node harness.mjs <repoRoot> <outDir> <playwrightModule>
import fs from "node:fs";
import path from "node:path";
const [root, out, pwMod] = process.argv.slice(2);
const { chromium } = await import(pwMod);
const viem = await import(path.join(root, "web/node_modules/viem/_esm/index.js"));
const { wishGardenAbi } = await import(path.join(root, "web/src/abi/WishGarden.ts"));
const { decodeFunctionData, encodeFunctionResult, encodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, multicall3Abi, numberToHex } = viem;
fs.mkdirSync(out, { recursive: true });

const ME = "0x00000000000000000000000000000000000000a1";
const GARDEN = "0x33a514c5e2028f1affd70b82f170e8193df030a5";
const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const MC3 = "0xca11bde05977b3631167028862be2a173976ca11";
const HEAD = 26500000n;
const T0 = Date.now();
const head = () => HEAD + BigInt(Math.floor((Date.now() - T0) / 1000));
const H = (c) => `0x${c.repeat(64)}`.slice(0, 66);
const DIST = path.join(root, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".md": "text/plain" };
const RPC_HOSTS = ["ethereum-rpc.publicnode.com", "eth.drpc.org", "1rpc.io", "eth.merkle.io", "mainnet.base.org", "base-rpc.publicnode.com", "base.drpc.org"];
const EXE = process.env.CHROME_EXE;

function zeroOf(p) {
  if (p.type.endsWith("]")) return [];
  if (p.type === "tuple") return Object.fromEntries((p.components ?? []).map((c, i) => [c.name || i, zeroOf(c)]));
  if (p.type.startsWith("uint") || p.type.startsWith("int")) return 0n;
  if (p.type === "bool") return false;
  if (p.type === "address") return "0x0000000000000000000000000000000000000000";
  if (p.type === "string") return "";
  if (p.type.startsWith("bytes")) return p.type === "bytes" ? "0x" : `0x${"00".repeat(Number(p.type.slice(5)))}`;
  return 0n;
}

/** One scenario's labelled mock chain: shared chain state plus what each tab's receipt reads can see. */
function mockChain() {
  const st = { allowance: 0n, txs: new Map(), visible: new Map(), sends: [], buyReject: true, log: [] };
  const answer = (to, data) => {
    to = (to ?? "").toLowerCase();
    const abi = to === IMD ? erc20Abi : to === MC3 ? multicall3Abi : wishGardenAbi;
    let d;
    try { d = decodeFunctionData({ abi, data }); } catch { st.log.push(`UNDECODED eth_call to ${to} ${String(data).slice(0, 10)}`); return { ok: false, data: "0x" }; }
    const fn = abi.find((x) => x.type === "function" && x.name === d.functionName && (x.inputs?.length ?? 0) === (d.args?.length ?? 0));
    const vals = {
      activated: true, purchasesPaused: false, totalCandles: 1n, balanceOf: 10n * 10n ** 18n, allowance: st.allowance,
      rewardState: [1n, 9n * 10n ** 18n, 0n, 9n * 10n ** 18n, 0n], claimRewards: 9n * 10n ** 18n, decimals: 18, symbol: "IMD", getEthBalance: 10n ** 18n,
    };
    let v = vals[d.functionName];
    if (v === undefined) {
      const outs = fn?.outputs ?? [];
      v = outs.length === 1 ? zeroOf(outs[0]) : outs.map(zeroOf);
    }
    try { return { ok: true, data: encodeFunctionResult({ abi, functionName: d.functionName, result: v, args: d.args }) }; } catch { return { ok: true, data: "0x" }; }
  };
  const receiptOf = (hash) => {
    const t = st.txs.get(hash);
    if (!t) return null;
    return {
      transactionHash: hash, transactionIndex: "0x0", blockHash: H("9"), blockNumber: numberToHex(HEAD - 1n), from: ME, to: t.to,
      cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs: t.logs.map((l, i) => ({
        address: l.address, topics: l.topics, data: l.data, blockNumber: numberToHex(HEAD - 1n), transactionHash: hash, transactionIndex: "0x0",
        blockHash: H("9"), logIndex: numberToHex(i), removed: false,
      })), logsBloom: `0x${"00".repeat(256)}`, status: t.status ?? "0x1", type: "0x2",
    };
  };
  const txOf = (hash) => {
    const t = st.txs.get(hash);
    if (!t) return null;
    return {
      hash, from: ME, to: t.to, input: t.input, nonce: numberToHex(t.nonce), blockHash: H("9"), blockNumber: numberToHex(HEAD - 1n), transactionIndex: "0x0",
      value: "0x0", gas: "0x30000", type: "0x2", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x1", chainId: "0x1", v: "0x0", r: H("1"), s: H("1"), yParity: "0x0", accessList: [],
    };
  };
  function rpc(tab, host, m) {
    const p = m.params ?? [];
    const base = host.includes("base");
    switch (m.method) {
      case "eth_chainId": return base ? "0x2105" : "0x1";
      case "net_version": return base ? "8453" : "1";
      case "eth_blockNumber": return numberToHex(head());
      case "eth_gasPrice": return "0x3b9aca00";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getBalance": return numberToHex(10n ** 18n);
      case "eth_estimateGas": return "0x30000";
      case "eth_getTransactionCount": return "0x7";
      case "eth_getLogs": return [];
      case "eth_getCode": return "0x60";
      case "eth_getBlockByNumber": return { number: numberToHex(head()), hash: H("8"), parentHash: H("7"), timestamp: numberToHex(BigInt(Math.floor(Date.now() / 1000))), baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [], miner: ME, difficulty: "0x0", extraData: "0x", logsBloom: `0x${"00".repeat(256)}`, nonce: "0x0000000000000000", sha3Uncles: H("0"), size: "0x1", stateRoot: H("0"), receiptsRoot: H("0"), transactionsRoot: H("0"), uncles: [], mixHash: H("0"), totalDifficulty: "0x0" };
      case "eth_getTransactionReceipt": {
        const h = String(p[0]).toLowerCase();
        const seen = st.visible.get(`${tab}:${h}`) ?? st.visible.get(`*:${h}`) ?? false;
        st.log.push(`${tab} receipt ${h.slice(0, 10)} -> ${seen ? "receipt" : "null (delayed)"}`);
        return seen ? receiptOf(h) : null;
      }
      case "eth_getTransactionByHash": return txOf(String(p[0]).toLowerCase());
      case "eth_call": {
        const { to, data } = p[0];
        if ((to ?? "").toLowerCase() === MC3) {
          const d = decodeFunctionData({ abi: multicall3Abi, data });
          const res = d.args[0].map((c) => { const a = answer(c.target, c.callData); return { success: a.ok, returnData: a.data }; });
          return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: res });
        }
        const a = answer(to, data);
        if (!a.ok) st.log.push(`REVERT eth_call ${to} ${String(data).slice(0, 10)} from ${p[0].from}`);
        if (!a.ok) throw Object.assign(new Error("execution reverted"), { rpc: { code: 3, message: "execution reverted" } });
        return a.data;
      }
      default: return null;
    }
  }
  return { st, rpc };
}

async function serve(route, chain) {
  const req = route.request();
  const url = new URL(req.url());
  const tab = req.frame()?.page()?.__tab ?? "?";
  if (url.hostname === "everlight.test") {
    const f = path.join(DIST, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" } });
  }
  if (RPC_HOSTS.includes(url.hostname) && req.method() === "POST") {
    const body = JSON.parse(req.postData() ?? "{}");
    const one = (m) => { try { return { jsonrpc: "2.0", id: m.id, result: chain.rpc(tab, url.hostname, m) }; } catch (e) { return { jsonrpc: "2.0", id: m.id, error: e.rpc ?? { code: -32000, message: String(e.message) } }; } };
    const res = Array.isArray(body) ? body.map(one) : one(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
  }
  if (RPC_HOSTS.includes(url.hostname)) return route.fulfill({ status: 200, body: "" });
  return route.abort();
}

const WALLET = (me) => `(() => {
  const ME = "${me}";
  const listeners = {};
  const provider = {
    isMockTestWallet: true,
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ME];
      if (method === "eth_chainId") return "0x1";
      if (method === "net_version") return "1";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "eth_sendTransaction") {
        const r = await window.__mockSend(JSON.stringify(params[0]));
        if (r.reject) throw Object.assign(new Error("User rejected the request. (labelled mock wallet)"), { code: 4001 });
        return r.hash;
      }
      const res = await fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await res.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
      return j.result;
    },
    on(e, f) { (listeners[e] ??= []).push(f); return provider; },
    removeListener(e, f) { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); return provider; },
  };
  const info = { uuid: "00000000-0000-4000-8000-000000000001", name: "Labelled Mock Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.mock.wallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

const results = [];
const check = (scenario, name, ok, detail = "") => { results.push({ scenario, name, passed: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${scenario}] ${name}${detail ? ` — ${detail}` : ""}`); };

async function openTab(ctx, chain, name, hash, vp) {
  const page = await ctx.newPage();
  page.__tab = name;
  await page.setViewportSize(vp);
  page.on("pageerror", (e) => chain.st.log.push(`${name} pageerror ${e.message}`));
  await page.goto(`https://everlight.test/${hash}`);
  return page;
}
async function connect(page) {
  // the labelled wallet answers eth_accounts, so wagmi may reconnect it by itself; otherwise connect through the sheet
  for (let i = 0; i < 40; i++) {
    if (await page.getByText("0x0000…00A1").first().isVisible().catch(() => false)) return;
    const btn = page.getByRole("button", { name: "Connect wallet" }).first();
    if (i > 8 && await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.getByRole("button", { name: /Labelled Mock Wallet/ }).click();
    }
    await page.waitForTimeout(250);
  }
}
const until = async (page, f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await page.waitForTimeout(250); } return false; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");

async function claimScenario(browser, vp, label) {
  const S = `claim-${label}`;
  const chain = mockChain();
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(WALLET(ME));
  await ctx.route("**/*", (r) => serve(r, chain).catch((e) => { console.log("ROUTE ERROR", r.request().url().slice(0, 80), String(e).slice(0, 300)); return r.abort().catch(() => {}); }));
  const claimLog = (amount) => {
    const ev = wishGardenAbi.find((x) => x.type === "event" && x.name === "RewardsClaimed");
    return { address: GARDEN, topics: encodeEventTopics({ abi: [ev], eventName: "RewardsClaimed", args: { beneficiary: ME } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, amount]) };
  };
  const hashes = [H("a"), H("b")];
  let n = 0;
  await ctx.exposeFunction("__mockSend", (raw) => {
    const t = JSON.parse(raw);
    const hash = hashes[n++] ?? H("c");
    chain.st.sends.push({ to: t.to, data: (t.data ?? t.input ?? "").slice(0, 10), hash });
    chain.st.txs.set(hash, { to: GARDEN, input: t.data ?? t.input, nonce: 7 + n - 1, logs: [claimLog(hash === H("a") ? 2n * 10n ** 18n : 5n * 10n ** 18n)] });
    if (hash === H("b")) chain.st.visible.set(`*:${hash}`, true);
    return { hash };
  });
  const A = await openTab(ctx, chain, "tabA", "#/rewards", vp);
  await connect(A);
  const claimBtn = A.locator("button.cta.wide").first();
  await until(A, async () => /Claim 9/.test(await claimBtn.innerText().catch(() => "")));
  check(S, "tab A shows Claim 9 IMD (mocked rewardState)", /Claim 9/.test(await claimBtn.innerText()));
  await claimBtn.click();
  const pendingA = await until(A, async () => /Claim sent\. Waiting/.test(await text(A, ".steps")));
  check(S, "tab A: claim A sent, receipt delayed (mock returns null)", pendingA, await text(A, ".steps"));
  // tab B opens the site: its reload recovery reads A's receipt (visible to tab B only) and settles A
  chain.st.visible.set(`tabB:${H("a")}`, true);
  const B = await openTab(ctx, chain, "tabB", "#/rewards", vp);
  const settled = await until(A, async () => /settled in another tab/.test(await text(A, ".steps")));
  check(S, "tab B resolved claim A; tab A released it (resolved, link kept)", settled, await text(A, ".steps"));
  check(S, "tab A keeps claim A's link while resolved", (await A.locator(`.steps a[href$="${H("a")}"]`).count()) > 0);
  await A.screenshot({ path: path.join(out, `${S}-1-resolved-elsewhere.png`) });
  const enabled = await until(A, async () => (await claimBtn.isEnabled()) && /Claim 9/.test(await claimBtn.innerText()));
  check(S, "tab A: Claim is available again", enabled, await claimBtn.innerText());
  await claimBtn.click();
  const doneB = await until(A, async () => /Claimed 5(\.0+)? IMD/.test(await text(A, ".steps")));
  check(S, "tab A: claim B completed and shows B's receipt (5 IMD)", doneB, await text(A, ".steps"));
  // A's delayed receipt now arrives in tab A
  chain.st.visible.set(`tabA:${H("a")}`, true);
  const sawLate = await until(A, async () => chain.st.log.some((l) => l.startsWith(`tabA receipt ${H("a").slice(0, 10)} -> receipt`)), 15000);
  await A.waitForTimeout(2500);
  const steps = await text(A, ".steps");
  check(S, "A's delayed receipt was delivered to tab A", sawLate);
  check(S, "B remains the displayed result after A's delayed receipt", /Claimed 5(\.0+)? IMD/.test(steps) && !/^Claimed 2/m.test(steps), steps);
  check(S, "displayed receipt link is B's, not A's", (await A.locator(`.steps p:first-child a[href$="${H("b")}"]`).count()) === 1 && (await A.locator(`.steps p:first-child a[href$="${H("a")}"]`).count()) === 0);
  check(S, "A's outcome kept as history beside B", /An earlier claim also settled: 2(\.0+)? IMD claimed/.test(steps), steps);
  check(S, "exactly two claim transactions were requested", chain.st.sends.length === 2, JSON.stringify(chain.st.sends.map((s) => s.hash.slice(0, 6))));
  await A.screenshot({ path: path.join(out, `${S}-2-b-kept-after-late-a.png`) });
  check(S, "no page errors", !chain.st.log.some((l) => l.includes("pageerror")), chain.st.log.filter((l) => l.includes("pageerror")).join("; "));
  const overflow = await A.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(S, "no horizontal overflow", !overflow);
  await ctx.close();
  return chain.st.log;
}

async function approvalScenario(browser, vp, label) {
  const S = `approval-${label}`;
  const chain = mockChain();
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(WALLET(ME));
  await ctx.route("**/*", (r) => serve(r, chain).catch((e) => { console.log("ROUTE ERROR", r.request().url().slice(0, 80), String(e).slice(0, 300)); return r.abort().catch(() => {}); }));
  const AP = H("e");
  await ctx.exposeFunction("__mockSend", (raw) => {
    const t = JSON.parse(raw);
    const input = t.data ?? t.input ?? "0x";
    const isApprove = (t.to ?? "").toLowerCase() === IMD;
    chain.st.sends.push({ kind: isApprove ? "approve" : "buy", to: t.to, selector: input.slice(0, 10) });
    if (!isApprove) return { reject: true }; // the labelled mock wallet refuses the purchase signature: nothing is bought
    chain.st.txs.set(AP, { to: IMD, input, nonce: 7, logs: [] });
    return { hash: AP };
  });
  const A = await openTab(ctx, chain, "tabA", "#/light", vp);
  await connect(A);
  const cta = A.locator("section.light button.cta.wide").first();
  await until(A, async () => /Approve exactly 1 IMD/.test(await cta.innerText().catch(() => "")) && (await cta.isEnabled()));
  check(S, "tab A offers 'Approve exactly 1 IMD and light 1 candle' (mocked open sales)", /Approve exactly 1 IMD/.test(await cta.innerText()), await cta.innerText());
  await cta.click();
  const pending = await until(A, async () => /Approval sent\. Waiting/.test(await text(A, "section.light .steps")));
  check(S, "tab A: approval sent, hash known, receipt delayed (mock returns null)", pending, await text(A, "section.light .steps"));
  check(S, "tab A: button shows Working… and is disabled while waiting", /Working/.test(await cta.innerText()) && !(await cta.isEnabled()));
  await A.screenshot({ path: path.join(out, `${S}-1-waiting.png`) });
  // tab B: the approval is mined (mock chain), its receipt is visible to tab B only; the allowance is now 1 IMD
  chain.st.allowance = 10n ** 18n;
  chain.st.visible.set(`tabB:${AP}`, true);
  const B = await openTab(ctx, chain, "tabB", "#/light", vp);
  // phase 1: tab A's own receipt reads still return null, so it must not call the approval confirmed
  const released = await until(A, async () => /settled in another tab, but its receipt could not be read from here yet/.test(await text(A, "section.light .steps")), 30000);
  let steps = await text(A, "section.light .steps");
  check(S, "tab A released the approval-pending step (no longer 'Approval sent. Waiting…')", released && !/Approval sent\. Waiting/.test(steps), steps);
  check(S, "tab A does not infer success from the record disappearing (unresolved while its receipt read is null)", !/Approval confirmed/.test(steps));
  check(S, "tab A keeps the approval transaction link", (await A.locator(`section.light .steps a[href$="${AP}"]`).count()) > 0);
  check(S, "tab A offers a usable recovery control (Check again)", await A.getByRole("button", { name: "Check again" }).isEnabled().catch(() => false));
  const freed = await until(A, async () => (await cta.isEnabled()) && /^Light 1 candle/.test(await cta.innerText()));
  check(S, "form and run lock released; allowance re-read, so 'Light 1 candle' is offered (no second approval)", freed, await cta.innerText());
  check(S, "no purchase was requested automatically", chain.st.sends.filter((s) => s.kind === "buy").length === 0);
  await A.screenshot({ path: path.join(out, `${S}-2-released-unresolved.png`) });
  // phase 2: tab A's RPC recovers; the original, delayed approval receipt arrives in its still-running wait
  chain.st.visible.set(`tabA:${AP}`, true);
  const late = await until(A, async () => chain.st.log.some((l) => l.startsWith(`tabA receipt ${AP.slice(0, 10)} -> receipt`)), 15000);
  await A.waitForTimeout(6000);
  steps = await text(A, "section.light .steps");
  check(S, "A's delayed approval receipt was delivered to tab A", late);
  check(S, "delayed callback did not relock the form", (await cta.isEnabled()) && !/Working/.test(await cta.innerText()), await cta.innerText());
  check(S, "delayed callback did not send a purchase or resume the run", chain.st.sends.filter((s) => s.kind === "buy").length === 0 && !/Checking the purchase|Confirm the purchase|Purchase sent/.test(steps), steps);
  check(S, "delayed callback did not overwrite the shown state", /settled in another tab, but its receipt could not be read/.test(steps), steps);
  // phase 3: an explicit Check again verifies the receipt and the live allowance
  await A.getByRole("button", { name: "Check again" }).click();
  const recovered = await until(A, async () => /Approval confirmed; candle purchase not sent\./.test(await text(A, "section.light .steps")), 20000);
  steps = await text(A, "section.light .steps");
  check(S, "Check again: verified approval (receipt + calldata + allowance), purchase not sent", recovered, steps);
  check(S, "verified state keeps the approval receipt link", (await A.locator(`section.light .steps a[href$="${AP}"]`).count()) > 0);
  check(S, "verified state shows the re-read allowance (1 IMD)", /Allowance now\s*1(\.0+)? IMD/.test(steps), steps);
  check(S, "still no purchase requested", chain.st.sends.filter((s) => s.kind === "buy").length === 0);
  await A.screenshot({ path: path.join(out, `${S}-3-verified.png`) });
  // a fresh explicit action reaches the wallet exactly once (the labelled mock wallet rejects it)
  await cta.click();
  const asked = await until(A, async () => chain.st.sends.filter((s) => s.kind === "buy").length === 1, 15000);
  await A.waitForTimeout(800);
  check(S, "explicit click sends exactly one purchase request (buyCandles to the garden)", asked && chain.st.sends.filter((s) => s.kind === "buy")[0]?.to?.toLowerCase() === GARDEN, JSON.stringify(chain.st.sends));
  check(S, "exactly one approval was requested in total", chain.st.sends.filter((s) => s.kind === "approve").length === 1);
  await A.screenshot({ path: path.join(out, `${S}-4-explicit-next-action.png`) });
  check(S, "no page errors", !chain.st.log.some((l) => l.includes("pageerror")), chain.st.log.filter((l) => l.includes("pageerror")).join("; "));
  const overflow = await A.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(S, "no horizontal overflow", !overflow);
  await ctx.close();
  return chain.st.log;
}

const browser = await chromium.launch({ executablePath: EXE });
const logs = {};
for (const [label, vp] of (process.env.ONLY ? [["390x844", { width: 390, height: 844 }]] : [["390x844", { width: 390, height: 844 }], ["1280x800", { width: 1280, height: 800 }]])) {
  if (process.env.ONLY !== "approval") try { logs[`claim-${label}`] = await claimScenario(browser, vp, label); } catch (e) { check(`claim-${label}`, "scenario ran", false, String(e).slice(0, 400)); }
  if (process.env.ONLY !== "claim") try { logs[`approval-${label}`] = await approvalScenario(browser, vp, label); } catch (e) { check(`approval-${label}`, "scenario ran", false, String(e).slice(0, 400)); }
}
await browser.close();
for (const [k, v] of Object.entries(logs)) console.log(k, (v ?? []).filter((l) => /UNDECODED|REVERT|pageerror/.test(l)).slice(0, 8));
const passed = results.filter((r) => r.passed).length;
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ mocked: true, note: "Real Chromium tabs, mocked JSON-RPC and a labelled mock EIP-6963 wallet. Not live-chain transactions.", passed, failed: results.length - passed, results, rpcLog: Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, (v ?? []).filter((l) => !/receipt .* -> null/.test(l)).slice(0, 40)])) }, null, 1));
console.log(`${passed}/${results.length} passed`);
