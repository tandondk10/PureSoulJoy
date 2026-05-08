export type ScrollReason =
  | "user_message_added"
  | "assistant_pending_added"
  | "assistant_response_received"
  | "assistant_response_failed";

export function shouldScrollToEnd(reason: ScrollReason): boolean {
  return (
    reason === "user_message_added" ||
    reason === "assistant_pending_added" ||
    reason === "assistant_response_received" ||
    reason === "assistant_response_failed"
  );
}
