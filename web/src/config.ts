import { createConfig, fallback, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { base } from "viem/chains";
import { createPublicClient, type Address } from "viem";

/** Site metadata: the same values the <title>, description and og tags carry. */
export const SITE_NAME = "Everlight Garden";
export const SITE_DESCRIPTION =
  "A midnight garden of permanent onchain candles. Light a candle with 1 IMD on Ethereum and leave a public wish.";

/**
 * Live contracts (revised Everlight Garden). Source and ABI: launch-3312-everlight-garden-deploy-revised at
 * 5752e230de18fa714111903f03d258a1e93faf2e, docs/integration.json and docs/abi/WishGarden.json.
 * Readiness (bridge, activation, sales) is always read from the chain, never assumed here.
 */
export const SOURCE_REPO =
  "https://github.com/identity-md-launches/launch-3312-everlight-garden-deploy-revised/tree/5752e230de18fa714111903f03d258a1e93faf2e";
export const GARDEN: Address = "0x33a514c5e2028f1affd70b82f170e8193df030a5";
export const IMD: Address = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const BASE_RECEIVER: Address = "0x4FdE47d5b574F9F18bC86D9878A460e6b1373D1E";
export const BASE_IMD: Address = "0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105";
export const OWNER: Address = "0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9";
/**
 * Block of the garden's creation transaction 0x9305085fac09f628e90afdcd1d9a6dc5cfdbb21b2a8c36780eedbe10a6004a8e
 * (CREATE2 factory call, block 26448736); event queries start here.
 */
export const GARDEN_DEPLOY_BLOCK = 26448736n;
/** First Base block holding the receiver's code (found by a getCode bisection on 2026-11-21); Base event scans start here. */
export const BASE_RECEIVER_DEPLOY_BLOCK = 59865494n;
/**
 * Earlier garden (source f3ae2915, 30/30/30/5/5 split). Linked for its own history only: the site never reads,
 * caches or writes to it, and its candle IDs are never merged with the live garden's.
 */
export const LEGACY_GARDEN: Address = "0x39e55288f5b84dd867a784c95f110818ea8f3b31";
export const LEGACY_BASE_RECEIVER: Address = "0xb525358f3f1c531522a27092e8aa1c054bb963fc";

export const CANDLE_PRICE = 10n ** 18n;
export const MAX_BATCH = 50;
export const PAGE_SIZE = 100; // contract MAX_PAGE_SIZE
export const WISH_MAX_CODEPOINTS = 280;
export const WISH_MAX_BYTES = 1120;
/** EIP-7825 per-transaction gas cap; the contract docs give the bound used for estimates. */
export const TX_GAS_CAP = 16_777_216n;

/** Public, keyless RPCs. viem's fallback transport fails over in order. */
export const ETH_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
  "https://eth.merkle.io",
];
export const BASE_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"];

export const ETHERSCAN = "https://etherscan.io";
export const BASESCAN = "https://basescan.org";

export const LZSCAN = "https://layerzeroscan.com";

export const ethTransport = fallback(ETH_RPCS.map((u) => http(u, { timeout: 12_000, retryCount: 1, batch: { wait: 16 } })));

export const config = createConfig({
  // Ethereum first: purchases, claims and owner burn actions. Base only for the public burn retry / confirmation.
  chains: [mainnet, base],
  // EIP-6963 discovery lists every installed extension under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: { [mainnet.id]: ethTransport, [base.id]: fallback(BASE_RPCS.map((u) => http(u, { timeout: 12_000, retryCount: 1 }))) },
});

export const ethClient = createPublicClient({ chain: mainnet, transport: ethTransport, batch: { multicall: true } });
/** One client per Ethereum host, no transport retries: the activity scan picks hosts and narrows ranges itself. */
export const ETH_LOG_CLIENTS = ETH_RPCS.map((u) => ({
  name: new URL(u).host,
  client: createPublicClient({ chain: mainnet, transport: http(u, { timeout: 10_000, retryCount: 0 }) }),
}));
export const baseClient = createPublicClient({
  chain: base,
  transport: fallback(BASE_RPCS.map((u) => http(u, { timeout: 12_000, retryCount: 1 }))),
  batch: { multicall: true },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
