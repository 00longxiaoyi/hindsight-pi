import type { HindsightHandles } from "./client.js";
import { recordFlushFailure, recordFlushSuccess } from "./flush-state.js";
import { deleteQueue, readQueueRecords } from "./queue.js";

export interface FlushSessionResult {
  /** Number of queued records uploaded by this call (0 when the queue was empty). */
  flushed: number;
}

/**
 * Upload every queued record of one session, then drop the queue file.
 *
 * The queue is only deleted after the upload succeeds, so a failed or
 * interrupted flush is retried by the next trigger instead of losing records.
 */
export const flushSessionQueue = async (handles: HindsightHandles, sessionId: string): Promise<FlushSessionResult> => {
  const { records } = readQueueRecords(sessionId, "auto");
  if (records.length === 0) return { flushed: 0 };

  try {
    await handles.client.retainBatch(handles.bankId, records.map((record) => ({
      content: record.content,
      context: record.context,
      tags: record.tags,
      metadata: record.metadata,
      timestamp: record.timestamp,
      document_id: record.document_id,
      update_mode: record.update_mode,
      observation_scopes: record.observation_scopes,
    })), { async: false });
  } catch (error) {
    recordFlushFailure(error);
    throw error;
  }

  deleteQueue(sessionId, "auto");
  recordFlushSuccess();
  return { flushed: records.length };
};
