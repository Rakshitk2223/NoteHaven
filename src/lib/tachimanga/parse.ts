// Main-thread entry for the Tachimanga import: parse a picked .tmb in a Worker.
//
// Import this only from the lazily loaded Import… UI: the Worker (and with it
// sql.js + wasm + jszip) is created on call, never at module load.

import { MAX_BACKUP_BYTES } from './limits';
import type { ReaderParseResult, ReaderParseStage, ReaderWorkerMessage, ReaderWorkerRequest } from './types';

export interface ParseOptions {
  onStage?: (stage: ReaderParseStage) => void;
  /** Aborting terminates the Worker; the promise then resolves as 'worker_failed'. */
  signal?: AbortSignal;
}

const failed = (message: string): ReaderParseResult => ({ ok: false, error: { code: 'worker_failed', message } });

export async function parseReaderBackup(file: File, opts: ParseOptions = {}): Promise<ReaderParseResult> {
  if (file.size > MAX_BACKUP_BYTES) {
    return { ok: false, error: { code: 'too_large', message: `This file is over ${MAX_BACKUP_BYTES / 1024 / 1024} MB, which is too big to import on this device.` } };
  }
  const buffer = await file.arrayBuffer();
  if (opts.signal?.aborted) return failed('Import cancelled.');

  return new Promise<ReaderParseResult>((resolve) => {
    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (r: ReaderParseResult) => {
      if (settled) return;
      settled = true;
      worker.terminate(); // frees the whole wasm heap (iOS memory)
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => finish(failed('Import cancelled.'));
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (e: MessageEvent<ReaderWorkerMessage>) => {
      if (e.data.kind === 'progress') opts.onStage?.(e.data.stage);
      else finish(e.data.result);
    };
    // A crash or out-of-memory on a phone lands here: say so plainly.
    worker.onerror = () => finish(failed('This device ran out of memory or the importer crashed while reading the backup. Nothing was imported.'));
    worker.onmessageerror = () => finish(failed("The importer's result couldn't be read. Nothing was imported."));

    const msg: ReaderWorkerRequest = { kind: 'parse', file: buffer };
    worker.postMessage(msg, [buffer]); // transfer, not copy
  });
}
