/** Client-safe constants shared by cabinet server code and components. */

/** Dispute statuses in which the chat is still writable. */
export const ACTIVE_DISPUTE_STATUSES = ["OPEN", "SELLER_REPLIED", "ESCALATED"] as const;

/** Disputes can be opened up to 14 days after delivery (CONTRACTS §7). */
export const DISPUTE_WINDOW_DAYS = 14;

/** Chat polling interval (ms). */
export const CHAT_POLL_MS = 5000;
