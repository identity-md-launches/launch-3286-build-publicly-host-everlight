// MOCKED browser reproduction of the revision-18 review findings against the compiled export in dist/.
// Real Chromium pages, a labelled mock JSON-RPC (route interception: nothing reaches a chain) and an injected labelled
// EIP-6963 test wallet. No live chain, no real wallet, no real funds.
// Usage: node burn-harness.mjs <repoRoot> <outDir> <playwrightModule>
import fs from "node:fs";
import path from "node:path";
const [root, out, pwMod] = process.argv.slice(2);
const { chromium } = await import(pwMod);
const LAUNCH = { executablePath: process.env.CHROME_EXE, args: process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [] };
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
    nonce: { latest: 7, pending: 7 }, nonceAt: null, blockTxs: {}, ethLogs: [], ethHead: null, onQueueSim: null, ethLogMaxTo: 0n,
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
    else if (d.functionName === "queueBurn") { st.queueSims++; st.log.push(`sim queueBurn(${d.args[0]})`); st.onQueueSim?.(st.queueSims, st); v = st.nextJob; }
    else { const outs = fn?.outputs ?? []; v = outs.length === 1 ? zeroOf(outs[0]) : outs.map(zeroOf); }
    try { return { ok: true, data: encodeFunctionResult({ abi, functionName: d.functionName, result: v, args: d.args }) }; } catch (e) { st.log.push(`ENCODE ${d.functionName} ${String(e).slice(0, 80)}`); return { ok: true, data: "0x" }; }
  };
  const receiptOf = (hash) => {
    const t = st.txs.get(hash);
    if (!t || !t.mined) return null;
    const bn = numberToHex(t.block ?? head(t.base) - 1n);
    return { transactionHash: hash, transactionIndex: "0x0", blockHash: H("9"), blockNumber: bn, from: ME, to: t.to, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs: t.logs ?? [], logsBloom: `0x${"00".repeat(256)}`, status: t.status ?? "0x1", type: "0x2" };
  };
  const txOf = (hash) => {
    const t = st.txs.get(hash);
    if (!t) return null;
    return { hash, from: t.from ?? ME, to: t.to, input: t.input, nonce: numberToHex(t.nonce ?? 7), blockHash: t.mined ? H("9") : null, blockNumber: t.mined ? numberToHex(t.block ?? head(t.base) - 1n) : null, transactionIndex: t.mined ? "0x0" : null, value: t.value ?? "0x0", gas: "0x30000", type: "0x2", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x1", chainId: t.base ? "0x2105" : "0x1", v: "0x0", r: H("1"), s: H("1"), yParity: "0x0", accessList: [] };
  };
  const rsEv = burnReceiverAbi.find((x) => x.type === "event" && x.name === "ReceiptSent");
  const hd = (base) => (!base && st.ethHead !== null ? st.ethHead : head(base));
  st.hd = hd;
  function rpc(base, m) {
    const p = m.params ?? [];
    switch (m.method) {
      case "eth_chainId": return base ? "0x2105" : "0x1";
      case "net_version": return base ? "8453" : "1";
      case "eth_blockNumber": return numberToHex(hd(base));
      case "eth_gasPrice": return "0x3b9aca00";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getBalance": return numberToHex(10n ** 18n);
      case "eth_estimateGas": return "0x30000";
      case "eth_getTransactionCount": {
        const tag = p[1];
        if (tag === "pending") return numberToHex(st.nonce.pending);
        if (tag && tag !== "latest" && st.nonceAt) return numberToHex(st.nonceAt(BigInt(tag)));
        return numberToHex(st.nonce.latest);
      }
      case "eth_getCode": return "0x60";
      case "eth_getLogs": {
        const q = p[0], from = BigInt(q.fromBlock), to = BigInt(q.toBlock);
        if (!base) {
          st.log.push(`eth getLogs ${from}-${to}`);
          if (to > st.ethLogMaxTo) st.ethLogMaxTo = to;
          return st.ethLogs.filter((l) => l.block >= from && l.block <= to).map((l, i) => ({ address: GARDEN, topics: encodeEventTopics({ abi: wishGardenAbi, eventName: l.eventName, args: l.indexed }), data: encodeAbiParameters(l.types, l.values), blockNumber: numberToHex(l.block), transactionHash: l.hash, transactionIndex: "0x0", blockHash: H("9"), logIndex: numberToHex(i), removed: false }));
        }
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
      case "eth_getBlockByNumber": {
        const want = p[0] && p[0] !== "latest" && p[0] !== "pending" ? BigInt(p[0]) : hd(base);
        const txs = p[1] ? (st.blockTxs[String(want)] ?? []).map((t) => ({ ...txOf(t.hash), hash: t.hash, from: t.from, nonce: numberToHex(t.nonce), blockNumber: numberToHex(want) })) : [];
        return { number: numberToHex(want), hash: H("8"), parentHash: H("7"), timestamp: numberToHex(BigInt(Math.floor(Date.now() / 1000))), baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: txs, miner: ME, difficulty: "0x0", extraData: "0x", logsBloom: `0x${"00".repeat(256)}`, nonce: "0x0000000000000000", sha3Uncles: H("0"), size: "0x1", stateRoot: H("0"), receiptsRoot: H("0"), transactionsRoot: H("0"), uncles: [], mixHash: H("0"), totalDifficulty: "0x0" };
      }
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
        if (r.disconnect) throw Object.assign(new Error("The provider is disconnected. (labelled mock wallet)"), { code: 4900 });
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
  // one browser per context: the self-contained Chromium used here runs single-process, and closing a context
  // would otherwise end the shared browser
  const br = await chromium.launch(LAUNCH);
  const ctx = await br.newContext({ viewport: vp });
  const closeCtx = ctx.close.bind(ctx);
  ctx.close = async () => { await closeCtx().catch(() => {}); await br.close().catch(() => {}); };
  if (wallet) await ctx.addInitScript(WALLET(ME, chainHex));
  await ctx.route("**/*", (r) => serve(r, chain).catch(() => r.abort().catch(() => {})));
  if (wallet) await ctx.exposeFunction("__mockSend", async (raw) => {
    const t = JSON.parse(raw);
    const abi = (t.to ?? "").toLowerCase() === RECEIVER ? burnReceiverAbi : wishGardenAbi;
    let fn = "?", args = [];
    try { const d = decodeFunctionData({ abi, data: t.data ?? t.input }); fn = d.functionName; args = (d.args ?? []).map(String); } catch {}
    const rec = { to: t.to, chain: t.chain, fn, args, value: t.value ?? "0x0", data: t.data ?? t.input };
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

// ---------- revision-18 scenarios (all MOCKED) ----------
const S = {};
const HA = H("a"), HB = H("b"), HC = H("c"), HD = H("d"), HE = H("e"), HQ = H("5"), HX = H("6");
const evLog = (eventName, indexed, types, values, hash) => ({ address: GARDEN, topics: encodeEventTopics({ abi: wishGardenAbi, eventName, args: indexed }), data: encodeAbiParameters(types, values), blockNumber: "0x1", transactionHash: hash, transactionIndex: "0x0", blockHash: H("9"), logIndex: "0x0", removed: false });
const queuedLog = (amount, hash) => evLog("BurnQueued", { jobId: 1n }, [{ type: "uint256" }], [amount], hash);
const jobOneQueued = (st, amount) => { st.eth.burnQueued -= amount; st.eth.burnReserved += amount; st.eth.burnJobCount = 1n; st.jobs[1] = [amount, H("0"), 0, 1]; st.nextJob = 2n; };
/** Mine `hash` (nonce 7, from the mock owner) at the current Ethereum head, with historical nonce reads to match. */
const mineAt = (st, hash, t) => {
  const X = st.hd(false);
  st.txs.set(hash, { ...t, mined: true, block: X, nonce: 7, from: ME });
  st.blockTxs[String(X)] = [{ hash, from: ME, nonce: 7 }];
  st.nonce = { latest: 8, pending: 8 };
  st.nonceAt = (b) => (b >= X ? 8 : 7);
  return X;
};
async function prepareQueue(p, amount) {
  await p.fill("#qmax", amount);
  const prep = p.getByRole("button", { name: "Prepare burn batch" });
  await until(p, () => prep.isEnabled());
  await prep.click();
  const conf = p.getByRole("button", { name: "Confirm in wallet" });
  return until(p, () => conf.isVisible());
}

S["5fd8d64b-queue-amount-capped"] = async (browser) => {
  const n = "5fd8d64b-queue-amount-capped";
  // the reviewer's case: a candle (0.3 IMD burn share) lands during the THIRD queueBurn simulation
  const chain = mockChain({ onQueueSim: (k, st) => { if (k === 3) { st.eth.totalBurnAllocated += 3n * E / 10n; st.eth.burnQueued += 3n * E / 10n; } } });
  const ctx = await setup(browser, chain, { send: async () => ({ reject: true }) });
  const p = await open(ctx, "#/treasury/burn");
  check(n, "connected the labelled mock owner", await connect(p));
  check(n, "review opened for a typed maximum of 6 IMD", await prepareQueue(p, "6"));
  const rv = await text(p, ".review");
  check(n, "review shows job #1, 5.4 IMD and the wallet request queueBurn(5400000000000000000)", /#1/.test(rv) && /5\.4 IMD/.test(rv) && /queueBurn\(5400000000000000000\)/.test(rv), rv);
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  await until(p, async () => /rejected/.test(await text(p, "p.bad")));
  const sims = chain.st.log.filter((l) => l.startsWith("sim queueBurn"));
  check(n, "three queueBurn simulations, every one with the reviewed 5.4 IMD as its argument", sims.length === 3 && sims.every((l) => l === "sim queueBurn(5400000000000000000)"), sims.join(", "));
  check(n, "exactly one wallet request: queueBurn(5400000000000000000), not the typed 6 IMD", chain.st.sends.length === 1 && chain.st.sends[0].fn === "queueBurn" && chain.st.sends[0].args[0] === "5400000000000000000", JSON.stringify(chain.st.sends.map((s) => [s.fn, s.args])));
  await shot(p, n);
  await ctx.close();
  // the same purchase landing after the owner's review and before Confirm's fresh read: a new review, no wallet request
  const c2 = mockChain({ onQueueSim: (k, st) => { if (k === 1) { st.eth.totalBurnAllocated += 3n * E / 10n; st.eth.burnQueued += 3n * E / 10n; } } });
  const ctx2 = await setup(browser, c2, { send: async () => ({ reject: true }) });
  const q = await open(ctx2, "#/treasury/burn");
  await connect(q);
  await prepareQueue(q, "6");
  await q.getByRole("button", { name: "Confirm in wallet" }).click();
  const said = await until(q, async () => /figures changed/.test(await text(q, "p.bad")));
  check(n, "purchase during the fresh review: owner is told the figures changed", said, await text(q, "p.bad"));
  check(n, "purchase during the fresh review: the new review shows 5.7 IMD", /5\.7 IMD/.test(await text(q, ".review")), await text(q, ".review"));
  check(n, "purchase during the fresh review: zero wallet requests", c2.st.sends.length === 0, JSON.stringify(c2.st.sends.map((s) => [s.fn, s.args])));
  await shot(q, `${n}-new-review`);
  await ctx2.close();
};

/** A wallet that broadcasts a pending transaction and then throws 4900 without returning its hash. */
const disconnectingSend = (chain, hash) => async (rec) => {
  if (chain.st.sends.length === 1) { chain.st.txs.set(hash, { to: rec.to, input: rec.data, nonce: 7, from: ME, mined: false }); chain.st.nonce.pending = 8; return { disconnect: true }; }
  return { reject: true };
};

S["736c741b-hashless-pasted-hash"] = async (browser) => {
  const n = "736c741b-hashless-pasted-hash";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { send: disconnectingSend(chain, HA) });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  await prepareQueue(p, "1");
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  check(n, "4900 without a hash is reported as uncertain", await until(p, async () => /did not return a transaction hash/.test(await text(p, "p.bad"))), await text(p, "p.bad"));
  let o = await ops(p);
  check(n, "the attempt is saved with its exact request, preflight nonce and block", o.length === 1 && o[0].stage === "signing" && o[0].nonce === 7 && !!o[0].block && o[0].req?.data === chain.st.sends[0].data && o[0].req?.to.toLowerCase() === GARDEN, JSON.stringify(o));
  await p.reload();
  await connect(p);
  const saved = p.locator(".saved");
  check(n, "after reload: the record is still shown", await until(p, () => saved.isVisible()));
  await p.locator(".saved").getByRole("button", { name: "Check again" }).click();
  check(n, "after reload: Check again says it may still be pending (nonce 7 not mined)", await until(p, async () => /may still be open in your wallet/.test(await text(p, ".saved"))), await text(p, ".saved"));
  check(n, "no forget or release control while it is unresolved", !(await p.getByRole("button", { name: /forget it|Release this record/ }).isVisible().catch(() => false)));
  await p.fill("#qmax", "1");
  check(n, "Prepare burn batch stays disabled while it is saved", !(await p.getByRole("button", { name: "Prepare burn batch" }).isEnabled()));
  const input = p.locator(".saved input").first();
  check(n, "a hash input is offered", await input.isVisible());
  // a hash carrying a different call is refused
  chain.st.txs.set(HC, { to: GARDEN, input: viem.encodeFunctionData({ abi: wishGardenAbi, functionName: "queueBurn", args: [2n * E] }), nonce: 7, from: ME, mined: false });
  await input.fill(HC);
  await p.getByRole("button", { name: "Use this hash" }).click();
  check(n, "a hash with different calldata is refused", await until(p, async () => /different call/.test(await text(p, ".saved"))), await text(p, ".saved"));
  await input.fill(`0x${"f".repeat(64)}`);
  await p.getByRole("button", { name: "Use this hash" }).click();
  check(n, "an unknown hash is refused", await until(p, async () => /was not found on Ethereum/.test(await text(p, ".saved"))), await text(p, ".saved"));
  await input.fill(HA);
  await p.getByRole("button", { name: "Use this hash" }).click();
  check(n, "the matching hash is accepted with its verified nonce", await until(p, async () => { const x = await ops(p); return x.length === 1 && x[0].hash === HA && x[0].nonceChecked && x[0].nonce === 7; }), JSON.stringify(await ops(p)));
  await shot(p, `${n}-accepted`);
  const x = mineAt(chain.st, HA, { to: GARDEN, input: chain.st.sends[0].data, logs: [queuedLog(E, HA)] });
  jobOneQueued(chain.st, E);
  check(n, "once mined: the record settles from its BurnQueued event", await until(p, async () => (await ops(p)).length === 0 && /Burn job #1 prepared with 1000000000000000000 token units/.test(await text(p, ".ok-note")), 30000), await text(p, ".ok-note"));
  check(n, "one wallet request in all", chain.st.sends.length === 1, JSON.stringify(chain.st.sends.map((s) => s.fn)));
  void x;
  await shot(p, n);
  await ctx.close();
};

S["736c741b-hashless-found-by-nonce"] = async (browser) => {
  const n = "736c741b-hashless-found-by-nonce";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { send: disconnectingSend(chain, HA) });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  await prepareQueue(p, "1");
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  await until(p, async () => /did not return a transaction hash/.test(await text(p, "p.bad")));
  await p.close();
  mineAt(chain.st, HA, { to: GARDEN, input: chain.st.sends[0].data, logs: [queuedLog(E, HA)] });
  jobOneQueued(chain.st, E);
  const q = await open(ctx, "#/treasury/burn");
  await connect(q);
  check(n, "after reload: the mined transaction carrying the saved request is found by nonce and settles the record", await until(q, async () => (await ops(q)).length === 0 && /Burn job #1 prepared/.test(await text(q, ".ok-note")), 30000), await text(q, ".ok-note") || await text(q, ".saved"));
  check(n, "one wallet request in all", chain.st.sends.length === 1);
  await shot(q, n);
  await ctx.close();
};

S["736c741b-hashless-not-found-release"] = async (browser) => {
  const n = "736c741b-hashless-not-found-release";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { send: async () => ({ disconnect: true }) });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  await prepareQueue(p, "1");
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  await until(p, async () => /did not return a transaction hash/.test(await text(p, "p.bad")));
  // nonce 7 is consumed by an unrelated self-transfer; nothing is pending
  mineAt(chain.st, HE, { to: ME, input: "0x" });
  await p.reload();
  await connect(p);
  await until(p, () => p.locator(".saved").isVisible());
  await p.locator(".saved").getByRole("button", { name: "Check again" }).click();
  const rel = p.getByRole("button", { name: "Release this record" });
  check(n, "nonce used by another transaction and nothing pending: release is offered with that evidence", await until(p, () => rel.isVisible()), await text(p, ".saved"));
  await shot(p, `${n}-evidence`);
  await rel.click();
  check(n, "release clears only that record", await until(p, async () => (await ops(p)).length === 0));
  await p.fill("#qmax", "1");
  check(n, "Prepare burn batch is available again", await until(p, () => p.getByRole("button", { name: "Prepare burn batch" }).isEnabled()));
  check(n, "one wallet request in all", chain.st.sends.length === 1);
  await ctx.close();
};

S["736c741b-replacement-after-reload"] = async (browser) => {
  const n = "736c741b-replacement-after-reload";
  const chain = mockChain();
  const ctx = await setup(browser, chain, { send: async (rec) => { chain.st.txs.set(HB, { to: rec.to, input: rec.data, nonce: 7, from: ME, mined: false }); chain.st.nonce.pending = 8; return { hash: HB }; } });
  const p = await open(ctx, "#/treasury/burn");
  await connect(p);
  await prepareQueue(p, "1");
  await p.getByRole("button", { name: "Confirm in wallet" }).click();
  check(n, "the sent transaction's sender and nonce are read and saved", await until(p, async () => { const o = await ops(p); return o.length === 1 && o[0].hash === HB && o[0].nonceChecked === true && o[0].nonce === 7 && o[0].from?.toLowerCase() === ME; }), JSON.stringify(await ops(p)));
  await p.close();
  // tab closed; a same-sender, same-nonce replacement is mined and the RPC drops the old hash
  const data = chain.st.sends[0].data;
  chain.st.txs.delete(HB);
  mineAt(chain.st, HD, { to: GARDEN, input: data, logs: [queuedLog(E, HD)] });
  jobOneQueued(chain.st, E);
  const q = await open(ctx, "#/treasury/burn");
  await connect(q);
  const ok = await until(q, async () => (await ops(q)).length === 0 && /replacement/.test(await text(q, ".ok-note")) && /Burn job #1 prepared/.test(await text(q, ".ok-note")), 30000);
  check(n, "after reopening: the mined replacement settles the record, reported as a replacement with job #1", ok, await text(q, ".ok-note") || await text(q, ".saved"));
  const link = await q.locator(".ok-note a").getAttribute("href").catch(() => "");
  check(n, "the result links the replacement transaction", String(link).endsWith(HD), link);
  await q.fill("#qmax", "1");
  check(n, "Prepare burn batch is available again", await until(q, () => q.getByRole("button", { name: "Prepare burn batch" }).isEnabled()));
  check(n, "one wallet request in all", chain.st.sends.length === 1);
  await shot(q, n);
  await ctx.close();
};

S["dde298ac-footer-widths"] = async (browser) => {
  const n = "dde298ac-footer-widths";
  for (const [w, h] of [[901, 844], [960, 800], [1024, 768], [1100, 800], [1150, 800], [1151, 800], [1200, 800], [1279, 800], [1280, 800], [1440, 900], [390, 844], [320, 700]]) {
   // the single-process Chromium used here can crash while capturing; a crashed width is measured again once
   for (let attempt = 1; attempt <= 2; attempt++) { try {
    const chain = mockChain();
    const ctx = await setup(browser, chain, { vp: { width: w, height: h }, wallet: false });
    const p = await open(ctx, "#/");
    await until(p, async () => /Updated/.test(await text(p, ".burn-time")));
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => {
      const R = (el) => { const r = el.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, w: r.width, t: (el.innerText || el.getAttribute("aria-label") || "").slice(0, 30) }; };
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
      const all = (s) => [...document.querySelectorAll(s)].filter(vis).map(R);
      // the allocation list of a closed phone disclosure is not shown; on desktop the minimap sits in the strip's own map slot
      const split = [...document.querySelectorAll(".split li")].filter((el) => vis(el) && el.closest("details")?.open !== false).map(R), burn = all(".burn-live > p:not(.burn-time), .burn-time a, .burn-acts a, .burn-acts button, .burn-time"), find = all(".strip .find");
      const tools = all(".map-tools .minimap, .zoom"), strip = all(".strip")[0];
      const hit = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
      const over = [];
      for (const a of split) for (const b of burn) if (hit(a, b)) over.push(`${a.t} × ${b.t}`);
      for (const a of find) for (const b of [...split, ...burn]) if (hit(a, b)) over.push(`${a.t} × ${b.t}`);
      for (const a of tools) for (const b of [...split, ...burn, ...find]) if (hit(a, b)) over.push(`tool ${a.t} × ${b.t}`);
      if (innerWidth <= 1150) for (const a of tools) if (strip && hit(a, strip)) over.push(`tool ${a.t} × strip`);
      const out = [...split, ...burn, ...find].filter((r) => r.x0 < -0.5 || r.x1 > innerWidth + 0.5).map((r) => `${r.t} ${r.x0.toFixed(0)}–${r.x1.toFixed(0)}`);
      return { over, out, strip: strip ? strip.y1 - strip.y0 : 0, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    check(n, `${w}×${h}: no overlap between search, allocation, counters, links and map tools`, m.over.length === 0, m.over.join("; "));
    check(n, `${w}×${h}: allocation, counters and both links inside the viewport; no horizontal scroll`, m.out.length === 0 && m.sw <= m.iw, `${m.out.join("; ")} scrollWidth ${m.sw} strip ${m.strip.toFixed(0)}px`);
    if ([901, 1024, 1150, 1280].includes(w)) await shot(p, `${n}-${w}`);
    await ctx.close();
    break;
   } catch (e) { if (attempt === 2) throw e; console.log(`retrying ${w}px after: ${String(e).slice(0, 80)}`); } }
  }
};

S["de013622-history-refresh"] = async (browser) => {
  const n = "de013622-history-refresh";
  const chain = mockChain({ ethHead: 26500000n });
  const st = chain.st;
  st.eth = { ...st.eth, burnQueued: 44n * E / 10n, burnReserved: E, burnJobCount: 1n };
  st.jobs[1] = [E, H("0"), 0, 1];
  st.ethLogs.push({ block: 26499990n, eventName: "BurnQueued", indexed: { jobId: 1n }, types: [{ type: "uint256" }], values: [E], hash: HQ });
  const ctx = await setup(browser, chain, { wallet: false });
  const p = await open(ctx, "#/treasury/burn");
  check(n, "reserved job #1 shows its BurnQueued link", await until(p, async () => /Reserved, not sent/.test(await text(p, ".job")) && /BurnQueued/.test(await text(p, ".job"))), await text(p, ".job"));
  // the same job is dispatched at 26500001; the snapshot moves to 26500002
  st.ethHead = 26500002n;
  st.jobs[1] = [E, GA, 1, 3];
  st.eth = { ...st.eth, burnReserved: 0n, burnInTransit: E };
  st.ethLogs.push({ block: 26500001n, eventName: "BurnDispatched", indexed: { jobId: 1n, guid: GA }, types: [{ type: "uint256" }, { type: "uint32" }], values: [E, 1], hash: HX });
  await p.locator(".snap").getByRole("button", { name: "Refresh" }).click();
  const ok = await until(p, async () => { const t = await text(p, ".job"); return /Dispatched, unacknowledged · 1 send attempt/.test(t) && /BurnDispatched/.test(t); });
  check(n, "after dashboard Refresh: the row shows the new state and its BurnDispatched link", ok, await text(p, ".job"));
  check(n, "the history query reached the new snapshot block", st.ethLogMaxTo >= 26500002n, `max toBlock ${st.ethLogMaxTo}; ${st.log.filter((l) => l.startsWith("eth getLogs")).join(", ")}`);
  const hrefs = await p.locator(".job a").evaluateAll((as) => as.map((a) => a.href));
  check(n, "GUID links to LayerZero Scan and BurnDispatched to Etherscan for the dispatch transaction", hrefs.some((h) => h.includes("layerzeroscan") && h.endsWith(HX)) && hrefs.some((h) => h.includes("etherscan.io/tx/") && h.endsWith(HX)), hrefs.join(" "));
  check(n, "the incremental scan covered only the new blocks", st.log.filter((l) => l.startsWith("eth getLogs")).some((l) => l === "eth getLogs 26500001-26500002"), st.log.filter((l) => l.startsWith("eth getLogs")).join(", "));
  // a failed incremental scan keeps the cached links and labels them current through the old block
  st.ethHead = 26500005n;
  const orig = chain.rpc;
  chain.rpc = (base, m) => { if (!base && m.method === "eth_getLogs") throw Object.assign(new Error("limit"), { rpc: { code: -32005, message: "rate limited" } }); return orig(base, m); };
  await p.locator(".snap").getByRole("button", { name: "Refresh" }).click();
  const lab = await until(p, async () => /current through Ethereum block 26500002/.test(await text(p, ".burn")), 90000);
  check(n, "failed incremental scan: cached links kept and labelled current through block 26500002", lab && /BurnDispatched/.test(await text(p, ".job")), (await text(p, ".burn")).match(/Transaction links are current[^.]*\./)?.[0] ?? "");
  await shot(p, n);
  await ctx.close();
};

const browser = null;
for (const [k, f] of Object.entries(S)) {
  if (process.env.ONLY && !k.startsWith(process.env.ONLY)) continue;
  try { await f(browser); } catch (e) { check(k, "scenario ran", false, String(e).slice(0, 400)); }
}
const passed = results.filter((r) => r.passed).length;
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ mocked: true, note: "Real Chromium, the compiled dist/, mocked JSON-RPC for Ethereum and Base and a labelled mock EIP-6963 wallet. No live chain reads and no transactions.", ranAt: new Date().toISOString(), passed, failed: results.length - passed, results }, null, 1));
console.log(`${passed}/${results.length} passed`);
