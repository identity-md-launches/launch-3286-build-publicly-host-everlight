import { useSwitchChain } from "wagmi";
import { mainnet } from "wagmi/chains";

/** Inline wrong-network control: says why the action is off and offers the switch next to it. */
export function WrongNetwork({ action }: { action: string }) {
  const { switchChain, isPending, error } = useSwitchChain();
  return (
    <div className="wrong-net" role="status">
      <p>Your wallet is on another network. Switch to Ethereum to {action}.</p>
      <button type="button" className="btn" onClick={() => switchChain({ chainId: mainnet.id })} disabled={isPending}>
        {isPending ? "Confirm in your wallet…" : "Switch to Ethereum"}
      </button>
      {error && <p className="bad" role="alert">The switch was not completed. Approve it in your wallet, or add Ethereum there.</p>}
    </div>
  );
}
