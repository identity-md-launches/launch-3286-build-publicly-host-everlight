import { createConfig, fallback, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { base } from "viem/chains";
import { createPublicClient, type Address } from "viem";

/** Site metadata: the same values the <title>, description and og tags carry. */
export const SITE_NAME = "Everlight Garden";
export const SITE_DESCRIPTION =
  "A midnight garden of permanent onchain candles. Light a candle with 1 IMD on Ethereum and leave a public wish.";

/** Existing deployed contracts (pinned source commit f3ae2915b2fc99c56079da2fc9addef2e94397e0). */
export const SOURCE_REPO =
  "https://github.com/identity-md-launches/launch-3281-everlightgarden-everlighttreasury-everli/tree/f3ae2915b2fc99c56079da2fc9addef2e94397e0";
export const GARDEN: Address = "0x39e55288f5b84dd867a784c95f110818ea8f3b31";
export const IMD: Address = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const BASE_RECEIVER: Address = "0xb525358f3f1c531522a27092e8aa1c054bb963fc";
export const BASE_IMD: Address = "0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105";
export const OWNER: Address = "0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9";
/** First block holding the garden's code (found by bisection on eth_getCode); event queries start here. */
export const GARDEN_DEPLOY_BLOCK = 26433359n;

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

export const ethTransport = fallback(ETH_RPCS.map((u) => http(u, { timeout: 12_000, retryCount: 1, batch: { wait: 16 } })));

export const config = createConfig({
  chains: [mainnet],
  // EIP-6963 discovery lists every installed extension under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: { [mainnet.id]: ethTransport },
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
