// Tachimanga import · the contract between the parser (a Web Worker), the
// planner (pure) and the Import… UI. TYPES ONLY: no runtime code, so any lane
// can import this without pulling in sql.js, jszip or the Supabase client.
//
// Flow: a .tmb File → parseReaderBackup() in a Worker → ReaderBackup →
// planImport(backup.titles, trackerRows, importMap, opts) → ImportPlan → the
// preview → apply (frontend: the one compare-and-swap progress writer plus
// media_bulk_journal). Nothing leaves the browser except writes to his own rows.
//
// PRIVACY: reader titles AND category names live only in memory, in his
// browser. Never log them, never send them to the edge, never persist them to
// the DB (media_import_map stores origin_key, a hash, and the thumbnail URL
// only; the category → status mapping is device-local, kept by the UI).
//
// STATUS: `Manga.status` in the backup is the series' PUBLICATION status
// (0 unknown … 6 hiatus), never his reading status, so the parser ignores it.
// His reading status lives in his categories (shelves); see PlanOptions.categoryMap.

import type { TrackerType } from '@/lib/media-sources';

// ---------------------------------------------------------------------------
// Parser output
// ---------------------------------------------------------------------------

/** One in-library entry from the reader backup (Suwayomi-style `Manga` row + aggregates). */
export interface ReaderTitle {
  /** sha256(`${source_id}:${manga.url}`) as lowercase hex (SubtleCrypto). The only identity ever stored. */
  origin_key: string;
  title: string;
  /** Other names, when the backup has any (the Suwayomi schema usually doesn't). */
  alt: string[];
  /** `Source.name`, e.g. the site he reads on. Null when the Source row or column is missing. */
  source_name: string | null;
  /** `Source.lang` (ISO-ish: 'ko', 'zh', 'ja', 'en', …). Guesses a NEW title's type; null when unknown. */
  source_lang: string | null;
  /** Source.is_nsfw, Extension.is_nsfw or an adult genre. Hidden by default, never matched or applied. */
  nsfw: boolean;
  /** Always true from the parser (it reads `in_library = 1` rows only); kept for the fixture and tests. */
  in_library: boolean;
  /** MAX(chapter_number) over READ chapters with chapter_number >= 0 (−1 = unknown). Decimal (12.5); null = none read. */
  read_max: number | null;
  /** MAX(chapter_number) over all chapters with chapter_number >= 0: the latest chapter out. Null = no numbered chapters. */
  latest_max: number | null;
  /** COUNT(DISTINCT chapter_number >= 0): scanlators repeat numbers, so this is the real chapter count. */
  distinct_chapters: number;
  /** Most recent read, ISO 8601 (History.last_read_at is in seconds; Chapter.last_read_at as a fallback). */
  last_read_at: string | null;
  /** `Manga.thumbnail_url`, only when it is an http(s) URL. */
  thumbnail_url: string | null;
  /** His categories (shelves) this entry is in, by category `order` ascending. Empty when none. */
  categories: ReaderCategory[];
}

/** A category (shelf) in the reader app. The name is private: device-only. */
export interface ReaderCategory {
  name: string;
  /** The app's own sort order (Category.order); ties keep the backup's id order. */
  order: number;
}

/** Optional backup features. Each false switch disables only that feature (never the import). */
export interface ReaderFeatures {
  nsfw: boolean;         // Source.is_nsfw / Extension.is_nsfw / Manga.genre present
  lang: boolean;         // Source.lang
  last_read_at: boolean; // History or Chapter.last_read_at
  categories: boolean;   // Category + CategoryManga
  thumbnails: boolean;   // Manga.thumbnail_url
}

export interface ReaderBackup {
  origin: 'tachimanga';
  /** The outer manifest's `version` (511 at the time of writing); null when the manifest is missing. */
  manifest_version: number | null;
  titles: ReaderTitle[];
  /** Every category in the backup, by `order`, with how many in-library titles it holds (for the mapping step). */
  categories: Array<ReaderCategory & { count: number }>;
  features: ReaderFeatures;
  /** Rows the parser dropped, for the preview's footer. */
  skipped: { not_in_library: number; no_title: number };
}

export type ReaderParseErrorCode =
  | 'not_a_zip'           // the file isn't a zip at all
  | 'no_inner_zip'        // outer zip has no inner *.zip
  | 'no_db'               // inner zip has no *.db
  | 'multiple_db'         // inner zip has 2+ *.db: never guess
  | 'not_sqlite'          // the .db isn't a readable SQLite file
  | 'unsupported_version' // a REQUIRED table/column is missing (see `missing`)
  | 'too_large'           // over the size cap before inflating
  | 'worker_failed';      // the Worker crashed or ran out of memory

export interface ReaderParseError {
  code: ReaderParseErrorCode;
  /** Plain-language sentence for the UI. Never contains titles. */
  message: string;
  /** For 'unsupported_version': the missing `table.column`s. */
  missing?: string[];
}

export type ReaderParseResult =
  | { ok: true; backup: ReaderBackup }
  | { ok: false; error: ReaderParseError };

/** Worker protocol: the main thread transfers the file's ArrayBuffer (zero-copy). */
export type ReaderWorkerRequest = { kind: 'parse'; file: ArrayBuffer };
export type ReaderParseStage = 'unzipping' | 'opening' | 'reading' | 'hashing';
export type ReaderWorkerMessage =
  | { kind: 'progress'; stage: ReaderParseStage }
  | { kind: 'done'; result: ReaderParseResult };

// ---------------------------------------------------------------------------
// Planner input
// ---------------------------------------------------------------------------

/** media_tracker.status values (the migration-29 CHECK). */
export type NoteHavenStatus =
  | 'Watching' | 'Reading' | 'Plan to Watch' | 'Plan to Read' | 'Completed' | 'Dropped' | 'On Hold';

/** Per category: the status it means, or 'keep' (no status change). Missing = 'keep'. */
export type CategoryMap = Record<string, NoteHavenStatus | 'keep'>;

/** The media_tracker fields the planner reads (the caller selects them; reading types only). */
export interface PlanTrackerRow {
  id: number;
  title: string;
  type: string;
  status: string | null;
  current_chapter: number | null;
  cover_image: string | null;
  cover_pinned: boolean;
  link_status: string | null;
  source: string | null;
  source_id: string | null;
  platform: string | null;
  reader_latest_chapter: number | null;
  last_activity_at: string | null;
  /** media_source_meta.alt_titles for a linked row (the third match step). */
  alt_titles?: string[] | null;
}

/** A media_import_map row (migration 29). */
export interface PlanImportMapRow {
  origin_key: string;
  media_id: number;
  reader_cover: string | null;
}

export interface PlanOptions {
  /** Include NSFW entries in the groups (default false: counted in `hidden.nsfw` only). */
  showNsfw?: boolean;
  /**
   * Category → status. Default: every category 'keep', so the import changes NO
   * statuses. A mapped category proposes a change (pre-ticked); a title in
   * several mapped categories takes the first by `order`, and if they disagree
   * the proposal is unticked with `conflict`.
   */
  categoryMap?: CategoryMap;
  /** ISO timestamp stamped on writes (reader_checked_at); injectable for tests. Default: now. */
  now?: string;
}

// ---------------------------------------------------------------------------
// Planner output
// ---------------------------------------------------------------------------

/** How a reader entry found its NoteHaven row, strongest first. */
export type PlanMatchVia = 'map' | 'title' | 'alt_title';

export interface CoverProposal {
  url: string;
  /**
   * Why it's offered: the row has no cover, a wrong-medium or a hotlink-blocked
   * one (all pre-ticked), or a fine cover with the reader's art as an option
   * ('alternative', unticked). Pinned or linked rows never get a proposal.
   */
  reason: 'missing' | 'wrong_medium' | 'blocked' | 'alternative';
  ticked: boolean;
}

/**
 * What applying a row writes to media_tracker, split by who decides:
 *   · `progress`: tickable (current_chapter), CAS against `expected`.
 *   · `status`: tickable (see StatusProposal), CAS against `expected`.
 *   · `cover`: tickable (see CoverProposal).
 *   · `auto`: applied with the row when non-empty (latest, platform-if-empty,
 *     last_activity_at). Never rating, title, type or resume_url.
 * Undefined keys are not written. An empty plan writes nothing at all.
 */
export interface TrackerPatch {
  current_chapter?: number;
  reader_latest_chapter?: number;
  reader_checked_at?: string;
  platform?: string;
  last_activity_at?: string;
  status?: NoteHavenStatus;
  cover_image?: string;
  cover_origin?: 'reader';
}

/** A proposed status change. Only from a mapped category, or the one built-in rule. */
export interface StatusProposal {
  from: string | null;
  to: NoteHavenStatus;
  /** 'category' = his categoryMap; 'started' = a "Plan to Read" row with ≥1 chapter read → Reading. */
  reason: 'category' | 'started';
  /** The mapped category that decided it (private: display only, never stored). */
  category?: string;
  /** Two mapped categories disagree: shown, unticked. */
  conflict?: boolean;
  ticked: boolean;
}

/** media_import_map rows to insert (new keys) or update (a changed reader_cover). */
export interface ImportMapWrite {
  origin_key: string;
  media_id: number;
  reader_cover: string | null;
}

/** A reader entry matched to one NoteHaven row. */
export interface PlanRow {
  media_id: number;
  /** NoteHaven's title (display name; never replaced). */
  title: string;
  type: string;
  via: PlanMatchVia;
  /** The reader entries merged onto this row (two sources for one work → "merged 2 sources"). First = the one that won. */
  readers: ReaderTitle[];
  /** Progress now (the compare-and-swap snapshot) and what the import would set. */
  from: number | null;
  to: number | null;
  /** Ticked by default only in `forward`; `noteHavenAhead` needs a per-row "Set back". */
  ticked: boolean;
  /** Exactly what apply may write; see TrackerPatch. `expected` is the CAS guard. */
  progress: Pick<TrackerPatch, 'current_chapter'> | null;
  status: StatusProposal | null;
  auto: Omit<TrackerPatch, 'current_chapter' | 'status' | 'cover_image' | 'cover_origin'>;
  expected: { current_chapter: number | null; status: string | null };
  cover: CoverProposal | null;
  map: ImportMapWrite[];
}

/** A reader entry with plausible but uncertain NoteHaven matches: pick one, or Skip. */
export interface NeedsMatchRow {
  reader: ReaderTitle;
  /** Top 3 of his rows, best first. */
  candidates: Array<{ media_id: number; title: string; type: string; score: number }>;
}

/** A reader entry with no NoteHaven row: offered as a new title, never pre-ticked. */
export interface NewTitleRow {
  reader: ReaderTitle;
  /** From Source.lang (ko → Manhwa, zh → Manhua, ja → Manga); null = he must pick (required). */
  guessed_type: Extract<TrackerType, 'Manga' | 'Manhwa' | 'Manhua'> | null;
  /** Starting progress for the new row: floor(read_max), or null. */
  progress: number | null;
  /** From a mapped category (first by order), else 'Reading' if any chapter is read, else 'Plan to Read'. */
  status: NoteHavenStatus;
  ticked: false;
}

export interface ImportPlan {
  /** Import is ahead of NoteHaven: ticked. */
  forward: PlanRow[];
  /** Same progress (may still carry `auto` writes or a status proposal). Collapsed, but the UI must surface ticked status changes. */
  same: PlanRow[];
  /** NoteHaven is ahead: never applied unless he ticks "Set back" on the row. */
  noteHavenAhead: PlanRow[];
  needsMatch: NeedsMatchRow[];
  /** Unticked, one checkbox per row, no select-all. */
  notInNoteHaven: NewTitleRow[];
  /** Entries left out of every group (and never matched or applied) unless `showNsfw`. */
  hidden: { nsfw: number };
  /** Rows (in any group) with a ticked status proposal, for the header ("3 status changes"). */
  statusChanges: number;
  /** Rows (in any group) whose apply would write something; 0 means re-running changes nothing. */
  writes: number;
}
