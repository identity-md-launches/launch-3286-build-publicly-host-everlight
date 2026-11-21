// MOCKED browser reproduction of the revision-17 review findings against the compiled export in dist/.
// Real Chromium pages, a labelled mock JSON-RPC (route interception: nothing reaches a chain) and an injected labelled
// EIP-6963 test wallet. No live chain, no real wallet, no real funds.
// Usage: node burn-harness.mjs <repoRoot> <outDir> <playwrightModule>
import fs from "node:fs";
import path from "node:path";
const [root, out, pwMod] = process.argv.slice(2);
const { chromium } = await import(pwMod);
const viem = await import(path.join(root, "web/node_modules/viem/_esm/index.js"));
const { wishGardenAbi } = await import(path.join(root, "web/src/abi/WishGarden.ts"));
const { burnReceiverAbi } = await import(path.join(root, "web/src/abi/EverlightBurnReceiver.ts"));
const { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, encodeEventTopics, multicall3Abi, numberToHex } = viem;
fs.mkdirSync(path.join(out, "screens"), { recursive: true });

const ME = "0x00000000000000000000000000000000000000a1";
const GARDEN = "0x33a514c5e2028f1affd70b82f170e8193df030a5";
const RECEIVER = "0x4fde47d5b574f9f18bc86d9878a460e6b1373d1e";
const MC3 = "0xca11bde05977b3631167028862be2a173976ca11";
const E = 10n ** 18n, U = 10n ** 12n;
const GA = `0x${"ab".repeat(32)}`, GC = `0x${"cd".repeat(32)}`, MSG = `0x${"ee".repeat(32)}`, RTX = `0x${"77".repeat(32)}`;
const T0 = Date.now();
const ETH_HEAD = 26500000n, BASE_HEAD = 60269000n;
const head = (base) => (base ? BASE_HEAD : ETH_HEAD) + BigInt(Math.floor((Date.now() - T0) / 12000));
const H = (c) => `0x${c.repeat(64)}`.slice(0, 66);
const DIST = path.join(root, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg" };
const BASE_HOSTS = ["mainnet.base.org", "base-rpc.publicnode.com", "base.drpc.org"];
const ETH_HOSTS = ["ethereum-rpc.publicnode.com", "eth.drpc.org", "1rpc.io", "eth.merkle.io"];

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

/** Labelled mock state for both chains. Every value here is a fixture. */
function mockChain(over = {}) {
  const st = {
    eth: { totalBurnAllocated: 54n * E / 10n, burnQueued: 54n * E / 10n, burnReserved: 0n, burnInTransit: 0n, confirmedBurn: 0n, failedBurnAmount: 0n, burnJobCount: 0n, bridgeDust: 0n, owner: ME, activated: true, baseReady: true, purchasesPaused: false, totalCandles: 1n },
    base: { totalReceived: 0n, pendingBurn: 0n, failedBurn: 0n, totalBurned: 0n, activated: true, owner: ME },
    jobs: {}, jobGuids: {}, deliveries: {}, nextJob: 1n,
    dispatchSims: [], queueSims: 0, fee: 10n ** 15n,
    baseDown: false, baseRangeLimit: 0n, receiptSentAt: null,
    txs: new Map(), sends: [], calls: [], log: [],
    ...over,
  };
  const answer = (base, to, data) => {
    to = (to ?? "").toLowerCase();
    const abi = to === RECEIVER ? burnReceiverAbi : wishGardenAbi;
    let d;
    try { d = decodeFunctionData({ abi, data }); } catch { st.log.push(`UNDECODED ${to} ${String(data).slice(0, 10)}`); return { ok: false, data: "0x" }; }
    const fn = abi.find((x) => x.type === "function" && x.name === d.functionName && (x.inputs?.length ?? 0) === (d.args?.length ?? 0));
    st.calls.push(`${base ? "base" : "eth"}:${d.functionName}`);
    let v;
    const src = to === RECEIVER ? st.base : st.eth;
    if (d.functionName in src) v = src[d.functionName];
    else if (d.functionName === "burnJobs") { const j = st.jobs[String(d.args[0])] ?? [0n, H("0"), 0, 0]; v = j; }
    else if (d.functionName === "jobGuids") v = st.jobGuids[String(d.args[0])] ?? H("0");
    else if (d.functionName === "deliveries") v = st.deliveries[String(d.args[0]).toLowerCase()] ?? [0n, 0n, 0, 0, false];
    else if (d.functionName === "quoteBurn" || d.functionName === "quoteReceipt") v = { nativeFee: st.fee, lzTokenFee: 0n };
    else if (d.functionName === "dispatchBurn") { const r = st.dispatchSims.length ? st.dispatchSims.shift() : true; st.log.push(`sim dispatchBurn -> ${r}`); v = r; }
    else if (d.functionName === "queueBurn") { st.queueSims++; v = st.nextJob; }
    else { const outs = fn?.outputs ?? []; v = outs.length === 1 ? zeroOf(outs[0]) : outs.map(zeroOf); }
    try { return { ok: true, data: encodeFunctionResult({ abi, functionName: d.functionName, result: v, args: d.args }) }; } catch (e) { st.log.push(`ENCODE ${d.functionName} ${String(e).slice(0, 80)}`); return { ok: true, data: "0x" }; }
  };
  const receiptOf = (hash) => {
    const t = st.txs.get(hash);
    if (!t || !t.mined) return null;
    const bn = numberToHex(head(t.base) - 1n);
    return { transactionHash: hash, transactionIndex: "0x0", blockHash: H("9"), blockNumber: bn, from: ME, to: t.to, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`, status: t.status ?? "0x1", type: "0x2" };
  };
  const txOf = (hash) => {
    const t = st.txs.get(hash);
    if (!t) return null;
    return { hash, from: ME, to: t.to, input: t.input, nonce: "0x7", blockHash: t.mined ? H("9") : null, blockNumber: t.mined ? numberToHex(head(t.base) - 1n) : null, transactionIndex: t.mined ? "0x0" : null, value: "0x0", gas: "0x30000", type: "0x2", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x1", chainId: t.base ? "0x2105" : "0x1", v: "0x0", r: H("1"), s: H("1"), yParity: "0x0", accessList: [] };
  };
  const rsEv = burnReceiverAbi.find((x) => x.type === "event" && x.name === "ReceiptSent");
  function rpc(base, m) {
    const p = m.params ?? [];
    switch (m.method) {
      case "eth_chainId": return base ? "0x2105" : "0x1";
      case "net_version": return base ? "8453" : "1";
      case "eth_blockNumber": return numberToHex(head(base));
      case "eth_gasPrice": return "0x3b9aca00";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getBalance": return numberToHex(10n ** 18n);
      case "eth_estimateGas": return "0x30000";
      case "eth_getTransactionCount": return "0x7";
      case "eth_getCode": return "0x60";
      case "eth_getLogs": {
        if (!base) return [];
        const q = p[0], from = BigInt(q.fromBlock), to = BigInt(q.toBlock);
        st.log.push(`base getLogs ${from}-${to}${q.topics?.[1] ? " burnGuid-filtered" : ""}`);
        if (st.baseRangeLimit && to - from + 1n > st.baseRangeLimit) throw Object.assign(new Error("block range too large"), { rpc: { code: -32005, message: "query exceeds max block range 1000" } });
        const at = st.receiptSentAt;
        const sig = encodeEventTopics({ abi: [rsEv], eventName: "ReceiptSent" })[0];
        const t0 = q.topics?.[0], t1 = q.topics?.[1];
        const sigOk = !t0 || (Array.isArray(t0) ? t0.includes(sig) : t0 === sig);
        const gOk = !t1 || String(t1).toLowerCase() === GA;
        if (at !== null && at >= from && at <= to && sigOk && gOk) {
          return [{ address: RECEIVER, topics: encodeEventTopics({ abi: [rsEv], eventName: "ReceiptSent", args: { burnGuid: GA, messageGuid: MSG } }), data: encodeAbiParameters([{ type: "uint8" }], [2]), blockNumber: numberToHex(at), transactionHash: RTX, transactionIndex: "0x0", blockHash: H("9"), logIndex: "0x0", removed: false }];
        }
        return [];
      }
      case "eth_getBlockByNumber": return { number: numberToHex(head(base)), hash: H("8"), parentHash: H("7"), timestamp: numberToHex(BigInt(Math.floor(Date.now() / 1000))), baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [], miner: ME, difficulty: "0x0", extraData: "0x", logsBloom: `0x${"00".repeat(256)}`, nonce: "0x0000000000000000", sha3Uncles: H("0"), size: "0x1", stateRoot: H("0"), receiptsRoot: H("0"), transactionsRoot: H("0"), uncles: [], mixHash: H("0"), totalDifficulty: "0x0" };
      case "eth_getTransactionReceipt": return receiptOf(String(p[0]).toLowerCase());
      case "eth_getTransactionByHash": return txOf(String(p[0]).toLowerCase());
      case "eth_call": {
        const { to, data } = p[0];
        if ((to ?? "").toLowerCase() === MC3) {
          const d = decodeFunctionData({ abi: multicall3Abi, data });
          const res = d.args[0].map((c) => { const a = answer(base, c.target, c.callData); return { success: a.ok, returnData: a.data }; });
          return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: res });
        }
        const a = answer(base, to, data);
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
  if (url.hostname === "everlight.test") {
    const f = path.join(DIST, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" } });
  }
  const base = BASE_HOSTS.includes(url.hostname);
  if ((base || ETH_HOSTS.includes(url.hostname)) && req.method() === "POST") {
    if (base && chain.st.baseDown) return route.fulfill({ status: 503, body: "mock outage" });
    const body = JSON.parse(req.postData() ?? "{}");
    const one = (m) => { try { return { jsonrpc: "2.0", id: m.id, result: chain.rpc(base, m) }; } catch (e) { return { jsonrpc: "2.0", id: m.id, error: e.rpc ?? { code: -32000, message: String(e.message) } }; } };
    const res = Array.isArray(body) ? body.map(one) : one(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
  }
  if (base || ETH_HOSTS.includes(url.hostname)) return route.fulfill({ status: 200, body: "" });
  return route.abort();
}

const WALLET = (me, chainHex) => `(() => {
  const ME = "${me}";
  let chain = "${chainHex}";
  const listeners = {};
  const emit = (e, v) => (listeners[e] ?? []).forEach((f) => f(v));
  const provider = {
    isMockTestWallet: true,
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ME];
      if (method === "eth_chainId") return chain;
      if (method === "net_version") return String(parseInt(chain, 16));
      if (method === "wallet_switchEthereumChain") { chain = params[0].chainId; emit("chainChanged", chain); return null; }
      if (method === "wallet_addEthereumChain") return null;
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "eth_sendTransaction") {
        const r = await window.__mockSend(JSON.stringify({ ...params[0], chain }));
        if (r.reject) throw Object.assign(new Error("User rejected the request. (labelled mock wallet)"), { code: 4001 });
        return r.hash;
      }
      const host = chain === "0x2105" ? "https://mainnet.base.org" : "https://ethereum-rpc.publicnode.com";
      const res = await fetch(host, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
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
const check = (scenario, name, ok, detail = "") => { results.push({ scenario, name, passed: !!ok, detail: String(detail).slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} [${scenario}] ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); };
const until = async (page, f, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await page.waitForTimeout(250); } return false; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const shot = (page, name) => page.screenshot({ path: path.join(out, "screens", `${name}.jpg`), type: "jpeg", quality: 55 });

/** A context with the labelled wallet and mocked RPC. send(tx) decides each wallet send. */
async function setup(browser, chain, { vp = { width: 390, height: 844 }, chainHex = "0x1", wallet = true, send } = {}) {
  const ctx = await browser.newContext({ viewport: vp });
  if (wallet) await ctx.addInitScript(WALLET(ME, chainHex));
  await ctx.route("**/*", (r) => serve(r, chain).catch(() => r.abort().catch(() => {})));
  if (wallet) await ctx.exposeFunction("__mockSend", async (raw) => {
    const t = JSON.parse(raw);
    const abi = (t.to ?? "").toLowerCase() === RECEIVER ? burnReceiverAbi : wishGardenAbi;
    let fn = "?", args = [];
    try { const d = decodeFunctionData({ abi, data: t.data ?? t.input }); fn = d.functionName; args = (d.args ?? []).map(String); } catch {}
    const rec = { to: t.to, chain: t.chain, fn, args, value: t.value ?? "0x0" };
    chain.st.sends.push(rec);
    return send ? await send(rec, t) : { reject: true };
  });
  return ctx;
}
async function open(ctx, hash) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`https://everlight.test/${hash}`);
  return page;
}
async function connect(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.getByText("0x0000…00A1").first().isVisible().catch(() => false)) return true;
    const btn = page.getByRole("button", { name: "Connect wallet" }).first();
    if (i > 8 && i % 8 === 1 && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.getByRole("button", { name: /Labelled Mock Wallet/ }).click().catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  return false;
}
const inView = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { sel, x0: +r.left.toFixed(1), x1: +r.right.toFixed(1), y0: +r.top.toFixed(1), y1: +r.bottom.toFixed(1), w: r.width, display: cs.display, ok: r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5 }; }), sel);
const ops = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("everlight:v1:burnops:0x33a514c5e2028f1affd70b82f170e8193df030a5") ?? "[]"));

const failedJobState = () => ({
  eth: { ...mockChain().st.eth, burnQueued: 0n, burnReserved: 54n * E / 10n, failedBurnAmount: 54n * E / 10n, burnJobCount: 1n },
  jobs: { 1: [54n * E / 10n, H("0"), 1, 2] },
});
const inTransit = (delivery, jobGuid, base) => ({
  eth: { ...mockChain().st.eth, burnQueued: 0n, burnInTransit: 54n * E / 10n, burnJobCount: 1n },
  base: { ...mockChain().st.base, ...base },
  jobs: { 1: [54n * E / 10n, GA, 1, 3] }, jobGuids: { 1: jobGuid }, deliveries: { [GA]: delivery },
});

// ---------- scenarios ----------
const S = {};

S["ee3b7c3e-final-dispatch-sim-false"] = async (browser) => {
  const n = "ee3b7c3e-final-dispatch-sim-false";
  const chain = mockChain({ ...failedJobState(), dispatchSims: [true, true, false] });
  const ctx = await setup(browser, chain, { send: async () => ({ hash: H("a") }) });
  const p = await open(ctx, "#/treasury/burn");
  check(n, "connected the labelled mock owner", await connect(p));
  const btn = p.getByRole("button", { name: "Retry failed send" });
  check(n, "Retry failed send is offered for Failed job #1", await until(p, () => btn.isEnabled()));
  await btn.click();
  const conf = p.getByRole("button", { name: "Confirm in wallet" });
  check(n, "review opened (simulation 1 returned true)", await until(p, () => conf.isVisible()));
  await conf.click();
  const said = await until(p, async () => /final simulation shows the bridge send failing/.test(await text(p, "p.bad")));
  check(n, "owner sees the failed-simulation message", said, await text(p, "p.bad"));
  check(n, "three dispatchBurn simulations ran (true, true, false)", chain.st.log.filter((l) => l.startsWith("sim dispatchBurn")).length === 3, chain.st.log.filter((l) => l.startsWith("sim")).join(", "));
  check(n, "zero wallet sends", chain.st.sends.length === 0, JSON.stringify(chain.st.sends));
  check(n, "no saved operation", (await ops(p)).length === 0);
  check(n, "job stays retryable (button still offered)", await btn.isVisible());
  await shot(p, n);
  await ctx.close();
};

S["eaa937a3-guid-mismatch"] = async (browser) => {
  const n = "eaa937a3-guid-mismatch";
  for (const [label, dv, base] of [
    ["failed", [1n, 54n * E / 10n, 1, 2, false], { totalReceived: 54n * E / 10n, pendingBurn: 54n * E / 10n, failedBurn: 54n * E / 10n }],
    ["burned-unacknowledged", [1n, 54n * E / 10n, 1, 3, false], { totalReceived: 54n * E / 10n, totalBurned: 54n * E / 10n }],
  ]) {
    const chain = mockChain(inTransit(dv, GC, base));
    const ctx = await setup(browser, chain, { chainHex: "0x2105", send: async () => ({ hash: H("b") }) });
    const p = await open(ctx, "#/treasury/burn");
    await connect(p);
    const note = await until(p, async () => /does not match this job/.test(await text(p, ".job")));
    check(n, `${label}: row reports the mismatch`, note, await text(p, ".job-d"));
    const name = label === "failed" ? "Retry failed burn" : "Send burn confirmation to Ethereum";
    const b = p.getByRole("button", { name });
    const vis = await b.isVisible().catch(() => false);
    check(n, `${label}: "${name}" is disabled`, vis && !(await b.isEnabled()), vis ? "visible" : "not rendered");
    if (vis) await b.click({ force: true }).catch(() => {});
    await p.waitForTimeout(1500);
    check(n, `${label}: no review opened`, !(await p.getByRole("button", { name: "Confirm in wallet" }).isVisible().catch(() => false)));
    check(n, `${label}: zero wallet requests`, chain.st.sends.length === 0, JSON.stringify(chain.st.sends));
    await shot(p, `${n}-${label}`);
    await ctx.close();
  }
  // control: a matching delivery is still actionable (authentication passes)
  const chain = mockChain(inTransit([1n, 54n * E / 10n, 1, 2, false], GA, { totalReceived: 54n * E / 10n, pendingBurn: 54n * E / 10n, failedBurn: 54n * E / 10n }));
  const ctx = await setup(browser, chain, { chainHex: "0x2105", send: async () => ({ reject: true }) });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  const b = p.getByRole("button", { name: "Retry failed burn" });
  check(n, "control: matching Failed delivery enables Retry failed burn", await until(p, () => b.isEnabled()));
  await b.click();
  const conf = p.getByRole("button", { name: "Confirm in wallet" });
  check(n, "control: review opens after fresh authentication", await until(p, () => conf.isVisible()), await text(p, "p.bad"));
  check(n, "control: preparation read burnJobs on Ethereum and jobGuids on Base", chain.st.calls.includes("eth:burnJobs") && chain.st.calls.includes("base:jobGuids"));
  await conf.click();
  await until(p, async () => /rejected/.test(await text(p, "p.bad")));
  check(n, "control: exactly one retryBurn request to the receiver on Base (mock wallet rejects it)", chain.st.sends.length === 1 && chain.st.sends[0].fn === "retryBurn" && chain.st.sends[0].to.toLowerCase() === RECEIVER, JSON.stringify(chain.st.sends));
  await ctx.close();
};

S["5352100c-cross-tab-late-hash"] = async (browser) => {
  const n = "5352100c-cross-tab-late-hash";
  const chain = mockChain();
  let release;
  const held = new Promise((r) => { release = r; });
  const ctx = await setup(browser, chain, { send: async () => { await held; return { hash: H("c") }; } });
  const A = await open(ctx, "#/treasury/burn");
  await connect(A);
  await A.fill("#qmax", "1");
  await A.getByRole("button", { name: "Prepare burn batch" }).click();
  await until(A, () => A.getByRole("button", { name: "Confirm in wallet" }).isVisible());
  await A.getByRole("button", { name: "Confirm in wallet" }).click();
  check(n, "tab A: wallet request open (no hash returned yet)", await until(A, async () => chain.st.sends.length === 1));
  const B = await open(ctx, "#/treasury/burn");
  await connect(B);
  const forget = B.getByRole("button", { name: "I checked my wallet: forget it" });
  check(n, "tab B sees tab A's saved signing operation", await until(B, () => forget.isVisible()));
  await forget.click();
  const refused = await until(B, async () => /still waiting on your wallet/.test(await text(B, "p.bad")));
  check(n, "tab B: forget refused while tab A's wallet request is open", refused, await text(B, "p.bad"));
  check(n, "saved operation still present", (await ops(B)).length === 1);
  await B.fill("#qmax", "1").catch(() => {});
  const prep = B.getByRole("button", { name: "Prepare burn batch" });
  check(n, "tab B: Prepare burn batch stays disabled (a burn operation is pending)", !(await prep.isEnabled().catch(() => true)), await text(B, ".owner"));
  check(n, "tab B opened no wallet request", chain.st.sends.length === 1);
  release();
  const kept = await until(A, async () => (await ops(A)).some((o) => o.hash === H("c")));
  check(n, "tab A's returned hash is saved", kept, JSON.stringify(await ops(A)));
  await A.reload();
  await until(A, async () => (await text(A, ".saved")).length > 0);
  const after = await ops(A);
  check(n, "after reloading tab A the operation and its hash survive", after.length === 1 && after[0].hash === H("c"), JSON.stringify(after));
  check(n, "the saved list shows the sent transaction", /sent .*waiting for its receipt/.test(await text(A, ".saved")), await text(A, ".saved"));
  await shot(A, n);
  await ctx.close();
};

S["20d3d3c6-mined-revert"] = async (browser) => {
  const n = "20d3d3c6-mined-revert";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { send: async (rec, t) => { chain.st.txs.set(H("d"), { to: t.to, input: t.data, mined: true, status: "0x0" }); return { hash: H("d") }; } });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  await p.fill("#qmax", "1");
  await p.getByRole("button", { name: "Prepare burn batch" }).click();
  await until(p, () => p.getByRole("button", { name: "Confirm in wallet" }).isVisible());
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  const rev = await until(p, async () => /reverted/.test(await text(p, "p.bad")), 40000);
  check(n, "a mined status 0x0 receipt is reported as an onchain revert", rev, await text(p, "p.bad"));
  check(n, "not reported as 'No receipt yet'", !/No receipt yet/.test(await text(p, "p.bad")));
  check(n, "the operation is removed (retry unlocked)", (await ops(p)).length === 0, JSON.stringify(await ops(p)));
  check(n, "Prepare burn batch is available again", await until(p, async () => { await p.fill("#qmax", "1"); return p.getByRole("button", { name: "Prepare burn batch" }).isEnabled(); }, 8000));
  await shot(p, n);
  // reload recovery: a saved sent op whose hash mined reverted is resolved, not kept locked
  await p.evaluate((h) => localStorage.setItem("everlight:v1:burnops:0x33a514c5e2028f1affd70b82f170e8193df030a5", JSON.stringify([{ id: "x", kind: "queue", chainId: 1, account: "0x00000000000000000000000000000000000000a1", target: "1", stage: "sent", hash: h, createdAt: 1 }])), H("d"));
  await p.reload();
  const rr = await until(p, async () => /reverted/.test(await text(p, "p.bad")) && (await ops(p)).length === 0, 40000);
  check(n, "after a reload the saved reverted operation resolves as a revert and unlocks", rr, await text(p, "p.bad"));
  await ctx.close();
};

S["f223abb2-queue-changed-after-review"] = async (browser) => {
  const n = "f223abb2-queue-changed-after-review";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { send: async () => ({ reject: true }) });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  await p.fill("#qmax", "5.4");
  await p.getByRole("button", { name: "Prepare burn batch" }).click();
  await until(p, () => p.getByRole("button", { name: "Confirm in wallet" }).isVisible());
  check(n, "review shows 5.4 IMD (5400000000000000000 units)", /5\.4 IMD \(5400000000000000000 units\)/.test(await text(p, ".review")), await text(p, ".review"));
  // another owner transaction reserved 3.4 IMD in job #1 meanwhile
  Object.assign(chain.st.eth, { burnQueued: 2n * E, burnReserved: 34n * E / 10n, burnJobCount: 1n });
  chain.st.jobs[1] = [34n * E / 10n, H("0"), 0, 1];
  chain.st.nextJob = 2n;
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  const changed = await until(p, async () => /figures changed since your review/.test(await text(p, "p.bad")));
  check(n, "confirm stops with 'figures changed'", changed, await text(p, "p.bad"));
  const rv = await text(p, ".review");
  check(n, "review replaced: 2 IMD reserved, job #2, 0 remaining", /2 IMD \(2000000000000000000 units\)/.test(rv) && /#2/.test(rv), rv);
  check(n, "zero wallet requests", chain.st.sends.length === 0, JSON.stringify(chain.st.sends));
  await shot(p, n);
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  await until(p, async () => chain.st.sends.length === 1);
  check(n, "after accepting the new review, one queueBurn request (mock wallet rejects it)", chain.st.sends.length === 1 && chain.st.sends[0].fn === "queueBurn", JSON.stringify(chain.st.sends));
  await ctx.close();
};

S["6715d5a3-tiny-footer-amounts"] = async (browser) => {
  const n = "6715d5a3-tiny-footer-amounts";
  for (const [label, eth, base, want] of [
    ["burned-1-unit", { burnQueued: 5399999n * U, confirmedBurn: U }, { totalReceived: U, totalBurned: U }, ["0.000001", "5.3999"]],
    ["pending-1-unit", { burnQueued: U, confirmedBurn: 5399999n * U }, { totalReceived: 5399999n * U, totalBurned: 5399999n * U }, ["5.3999", "0.000001"]],
  ]) {
    const chain = mockChain();
    Object.assign(chain.st.eth, eth); Object.assign(chain.st.base, base);
    const ctx = await setup(browser, chain, { wallet: false });
    const p = await open(ctx, "");
    await until(p, async () => /Updated/.test(await text(p, ".burn-time")));
    const vals = await p.locator(".burn-live strong").allInnerTexts();
    check(n, `${label}: footer shows burned ${want[0]} and pending ${want[1]}`, vals[0] === want[0] && vals[1] === want[1], JSON.stringify(vals));
    await shot(p, `${n}-${label}`);
    await ctx.close();
  }
};

S["3564d23a-rpc-outage-footer"] = async (browser) => {
  const n = "3564d23a-rpc-outage-footer";
  for (const w of [320, 390]) {
    const chain = mockChain({ baseDown: true });
    const ctx = await setup(browser, chain, { wallet: false, vp: { width: w, height: 844 } });
    const p = await open(ctx, "");
    const un = await until(p, async () => (await p.locator(".burn-live strong").allInnerTexts()).every((t) => t === "Unavailable") && /Unavailable/.test(await text(p, ".burn-time")), 45000);
    check(n, `${w}px: both counters say Unavailable`, un, JSON.stringify(await p.locator(".burn-live strong").allInnerTexts()));
    const boxes = await inView(p, ".burn-live p, .burn-refresh, .burn-link, .burn-time");
    check(n, `${w}px: counters, refresh, Burn details and status are inside the viewport`, boxes.every((b) => b.ok), JSON.stringify(boxes));
    const r = await inView(p, ".burn-refresh");
    check(n, `${w}px: refresh target is 44px wide`, Math.round(r[0].w) === 44, JSON.stringify(r));
    check(n, `${w}px: no horizontal overflow`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    await shot(p, `${n}-${w}`);
    await ctx.close();
  }
};

S["59d44d44-footer-last-update"] = async (browser) => {
  const n = "59d44d44-footer-last-update";
  for (const w of [320, 390, 1440]) {
    const chain = mockChain();
    const ctx = await setup(browser, chain, { wallet: false, vp: { width: w, height: 844 } });
    const p = await open(ctx, "");
    await until(p, async () => /Updated/.test(await text(p, ".burn-time")));
    const b = await inView(p, ".burn-time");
    check(n, `${w}px: last-update line is displayed in the footer and inside the viewport`, b[0]?.display !== "none" && b[0]?.ok, JSON.stringify(b));
    const links = await p.locator(".burn-time a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    check(n, `${w}px: footer links each snapshot block to its explorer`, links.some((h) => /etherscan\.io\/block\/\d+/.test(h)) && links.some((h) => /basescan\.org\/block\/\d+/.test(h)), JSON.stringify(links));
    const all = await inView(p, ".burn-time a, .burn-link, .burn-refresh");
    check(n, `${w}px: all footer links and refresh inside the viewport`, all.every((x) => x.ok), JSON.stringify(all));
    // phones: zoom and minimap float above the strip; desktop: the minimap sits in the strip, and must not cover its text
    const z = await p.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; };
      const one = (q) => { const e = document.querySelector(q); return e ? box(e) : null; };
      const text = [...document.querySelectorAll(".split li > *, .burn-live > *, .find > *")].map(box).filter(Boolean);
      return { strip: one(".strip"), zoom: one(".zoom"), mini: one(".minimap"), text };
    });
    const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const zoomOk = !z.zoom || z.zoom.b <= z.strip.t + 0.5;
    const covered = z.mini ? z.text.filter((t) => hit(z.mini, t)) : [];
    check(n, `${w}px: zoom stays above the strip; the minimap covers no footer text`, zoomOk && covered.length === 0, JSON.stringify({ strip: z.strip, zoom: z.zoom, mini: z.mini, covered }));
    await shot(p, `${n}-${w}`);
    await ctx.close();
  }
};

S["6c1e729b-footer-shrinks-on-widen"] = async (browser) => {
  const n = "6c1e729b-footer-shrinks-on-widen";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { wallet: false, vp: { width: 901, height: 844 } });
  const p = await open(ctx, "");
  await until(p, async () => /Updated/.test(await text(p, ".burn-time")));
  await p.waitForTimeout(500);
  const h = () => p.evaluate(() => ({ strip: Math.round(document.querySelector(".strip").getBoundingClientRect().height), min: getComputedStyle(document.querySelector(".strip")).minHeight, var: getComputedStyle(document.documentElement).getPropertyValue("--strip-h") }));
  const h901 = await h();
  await p.setViewportSize({ width: 1920, height: 844 });
  await p.waitForTimeout(800);
  const widened = await h();
  await p.reload();
  await until(p, async () => /Updated/.test(await text(p, ".burn-time")));
  await p.waitForTimeout(500);
  const fresh = await h();
  check(n, "after widening 901→1920 the strip is as tall as a fresh 1920 load", Math.abs(widened.strip - fresh.strip) <= 1, JSON.stringify({ h901, widened, fresh }));
  check(n, "the strip's minimum is independent of the measured --strip-h", widened.min !== widened.var.trim(), JSON.stringify(widened));
  await ctx.close();
};

S["957d9c55-recent-receipt-under-range-limit"] = async (browser) => {
  const n = "957d9c55-recent-receipt-under-range-limit";
  const chain = mockChain({ ...inTransit([1n, 54n * E / 10n, 1, 3, true], GA, { totalReceived: 54n * E / 10n, totalBurned: 54n * E / 10n }), baseRangeLimit: 1000n, receiptSentAt: BASE_HEAD - 1n });
  const ctx = await setup(browser, chain, { wallet: false });
  const p = await open(ctx, "#/treasury/burn");
  const link = p.locator(`.job a[href="https://layerzeroscan.com/tx/${RTX}"]`);
  const found = await until(p, async () => (await link.count()) > 0, 45000);
  check(n, "pending confirmation links to its ReceiptSent transaction on LayerZero Scan", found, await text(p, ".job"));
  check(n, "and on Basescan", (await p.locator(`.job a[href="https://basescan.org/tx/${RTX}"]`).count()) > 0);
  const jt = await text(p, ".job");
  check(n, "full burn GUID is shown", jt.includes(GA), jt);
  check(n, "message GUID is shown", jt.includes(MSG));
  check(n, "the burnGuid-filtered lookup started at the head", chain.st.log.some((l) => /getLogs 6026[0-9]{4}-6026900[0-9] burnGuid-filtered/.test(l)), chain.st.log.filter((l) => /filtered/.test(l)).slice(0, 6).join("; "));
  const box = await p.evaluate(() => { const d = document.querySelector(".job .mono"); return d ? d.scrollWidth <= d.clientWidth + 1 : false; });
  check(n, "the full GUID wraps inside its cell at 390px", box);
  check(n, "no horizontal overflow", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  await shot(p, n);
  await ctx.close();
};

S["9342fb89-dashboard-lede"] = async (browser) => {
  const n = "9342fb89-dashboard-lede";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { wallet: false });
  const p = await open(ctx, "#/treasury/burn");
  await until(p, async () => (await text(p, ".burn .lede")).length > 0);
  const t = await text(p, ".burn .lede");
  check(n, "lede states the first-candle 90% exception", t === "Track IMD allocated on Ethereum and burned on Base. The first candle allocates 90% to burn. Later candles allocate 30%.", t);
  await shot(p, n);
  await ctx.close();
};

const EXE = process.env.CHROME_EXE;
const browser = await chromium.launch({ executablePath: EXE });
for (const [k, f] of Object.entries(S)) {
  if (process.env.ONLY && !k.startsWith(process.env.ONLY)) continue;
  try { await f(browser); } catch (e) { check(k, "scenario ran", false, String(e).slice(0, 400)); }
}
await browser.close();
const passed = results.filter((r) => r.passed).length;
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ mocked: true, note: "Real Chromium, the compiled dist/, mocked JSON-RPC for Ethereum and Base and a labelled mock EIP-6963 wallet. No live chain reads and no transactions.", ranAt: new Date().toISOString(), passed, failed: results.length - passed, results }, null, 1));
console.log(`${passed}/${results.length} passed`);
