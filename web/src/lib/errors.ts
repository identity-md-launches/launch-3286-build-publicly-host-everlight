import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** An RPC or node refusing a call because of its gas limit (not an IMD allowance): the batch is too large to send. */
export function isGasCapError(e: unknown): boolean {
  const text = e instanceof BaseError ? `${e.shortMessage} ${e.message} ${e.details ?? ""}` : e instanceof Error ? e.message : String(e);
  return /gas required exceeds allowance|exceeds block gas limit|gas limit reached|intrinsic gas too high|gas too high|max gas/i.test(text);
}

/** One plain sentence that says what happened and what to do next. */
export function explainError(e: unknown): string {
  if (e instanceof Error && e.message.startsWith("GAS_TOO_HIGH:"))
    return `The contract estimates ${Number(e.message.slice(13)).toLocaleString("en-US")} gas for this purchase, more than one Ethereum transaction may use. Nothing was sent and your draft is kept; shorten the wishes in this purchase and try again.`;
  if (e instanceof Error && e.message.startsWith("RESPLIT:")) {
    const [n, est] = e.message.slice(8).split(":").map(Number);
    return n === 0
      ? "The contract estimates even the first candle of this purchase above one Ethereum transaction's gas limit. Nothing was sent and your draft is kept; shorten that wish and try again."
      : `The contract's gas estimate for this purchase was above one transaction's limit, so it was split again: the next purchase now holds the first ${n} candle${n > 1 ? "s" : ""} (${n} IMD, estimated ${est.toLocaleString("en-US")} gas). Nothing was sent and every wish is kept. Review the new plan below, then confirm again.`;
  }
  if (isGasCapError(e))
    return "The Ethereum RPC refused this purchase because it needs more gas than one transaction may use. Nothing was sent and your draft is kept; light fewer candles at once or shorten the wishes.";
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError) || /rejected|denied|cancel/i.test(e.shortMessage))
      return "You cancelled the request in your wallet. Nothing was sent.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name) return revertText(name);
    if (/insufficient funds/i.test(e.message)) return "Your wallet does not have enough ETH to pay gas for this transaction.";
    if (/ERC20InsufficientAllowance|transfer amount exceeds allowance|insufficient allowance/i.test(e.message)) return "The IMD approval is lower than the total. Approve again.";
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
