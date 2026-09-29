// Tachimanga backup parser, off the main thread. Loaded only when he picks a
// file (parse.ts creates it), so sql.js, its wasm and jszip never touch cold
// load. The main thread terminates this worker after one parse, so iOS
// reclaims the whole wasm heap (a 45 MB db peaks at ~3–4× in memory).

import initSqlJs from 'sql.js';
// The browser build of sql.js (package.json "exports".browser) pairs with this wasm.
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { parseBackupBytes, type SqlJsStatic } from './parse-core';
import type { ReaderWorkerMessage, ReaderWorkerRequest } from './types';

// The app compiles with the DOM lib only (a `reference lib="webworker"` here
// would leak worker globals into every file), so type just what this uses.
const ctx = self as unknown as {
  postMessage(m: ReaderWorkerMessage): void;
  onmessage: ((e: MessageEvent<ReaderWorkerRequest>) => void) | null;
};
const post = (m: ReaderWorkerMessage) => ctx.postMessage(m);

ctx.onmessage = async (e) => {
  if (e.data?.kind !== 'parse') return;
  try {
    const SQL = (await initSqlJs({ locateFile: () => wasmUrl })) as unknown as SqlJsStatic;
    const result = await parseBackupBytes(new Uint8Array(e.data.file), SQL, (stage) => post({ kind: 'progress', stage }));
    post({ kind: 'done', result });
  } catch {
    post({
      kind: 'done',
      result: { ok: false, error: { code: 'worker_failed', message: "The importer couldn't start on this device. Nothing was imported." } },
    });
  }
};
