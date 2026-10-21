import type { WriteFrequency } from "./config.js";

/**
 * Events that can drain the local retain queue.
 *
 * - `boundary` a session boundary (switch / fork / compact / shutdown). Always
 *   flushes regardless of `writeFrequency`; this is the durability floor.
 * - `message`  a single chat message finished. Drives `writeFrequency: "async"`.
 * - `turn`     one agent turn finished. Drives `"turn"` and numeric frequencies.
 */
export type FlushEvent = "message" | "turn" | "boundary";

export interface FlushDecisionInput {
  frequency: WriteFrequency | number;
  event: FlushEvent;
  /** Completed agent turns since the last successful flush. */
  turnsSinceLastFlush: number;
}

/**
 * Decide whether a flush may start for this event.
 *
 * `writeFrequency: "session"` returns false for both mid-session events on
 * purpose, so the queue is only drained at a boundary.
 */
export const shouldFlushOn = ({ frequency, event, turnsSinceLastFlush }: FlushDecisionInput): boolean => {
  if (event === "boundary") return true;
  if (typeof frequency === "number") return event === "turn" && turnsSinceLastFlush >= frequency;
  switch (frequency) {
    case "async": return event === "message";
    case "session": return false;
    case "turn":
    default: return event === "turn";
  }
};
