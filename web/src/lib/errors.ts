import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** One plain sentence that says what happened and what to do next. */
export function explainError(e: unknown): string {
  if (e instanceof Error && e.message.startsWith("GAS_TOO_HIGH:"))
    return `The contract estimates ${Number(e.message.slice(13)).toLocaleString("en-US")} gas for this purchase, more than one Ethereum transaction may use. Nothing was sent and your draft is kept; shorten the wishes in this purchase and try again.`;
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError) || /rejected|denied|cancel/i.test(e.shortMessage))
      return "You cancelled the request in your wallet. Nothing was sent.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name) return revertText(name);
    if (/insufficient funds/i.test(e.message)) return "Your wallet does not have enough ETH to pay gas for this transaction.";
    if (/exceeds allowance|ERC20InsufficientAllowance/i.test(e.message)) return "The IMD approval is lower than the total. Approve again.";
    if (/ERC20InsufficientBalance|transfer amount exceeds balance/i.test(e.message)) return "Your IMD balance is lower than the total.";
    if (/chain|network/i.test(e.shortMessage) && /mismatch|switch|unsupported/i.test(e.shortMessage))
      return "Your wallet is on another network. Switch to Ethereum and try again.";
    if (/HTTP request failed|timed out|fetch|network error/i.test(e.message))
      return "The Ethereum RPC did not answer. Check your connection and try again.";
    return e.shortMessage;
  }
  if (e instanceof Error) {
    if (/rejected|denied|cancel/i.test(e.message)) return "You cancelled the request in your wallet. Nothing was sent.";
    return e.message;
  }
  return String(e);
}

export function revertText(name: string): string {
  switch (name) {
    case "PurchasesDisabled":
      return "Sales are closed: the garden is not activated or purchases are paused.";
    case "InvalidQuantity":
      return "Choose between 1 and 50 candles.";
    case "InvalidStyle":
      return "One of the chosen styles does not exist. Pick a style from 1 to 7.";
    case "WishTooLong":
      return "A wish is longer than 280 characters or 1120 bytes. Shorten it.";
    case "InvalidUTF8":
      return "A wish contains characters that are not valid text. Retype it.";
    case "NothingToClaim":
      return "You have no rewards to claim yet.";
    case "IMDUnavailable":
    case "UnexpectedIMDDecimals":
      return "The IMD token did not answer as expected. Try again later.";
    case "WrongChain":
      return "This transaction must run on Ethereum mainnet.";
    case "InexactTransfer":
      return "The IMD transfer did not move the exact amount, so it was undone.";
    default:
      return `The contract refused the transaction (${name}).`;
  }
}
