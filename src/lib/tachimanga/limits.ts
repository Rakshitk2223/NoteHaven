// Shared by the main thread (parse.ts) and the parser (parse-core.ts), kept
// apart so the UI chunk doesn't pull in jszip just for a number.

/** Refuse before inflating anything past this (his real file is ~45 MB inflated). */
export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
