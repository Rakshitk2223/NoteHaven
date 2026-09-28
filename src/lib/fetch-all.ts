// Read every row of a query, past PostgREST's 1000-row response cap.
//
// A plain `await supabase.from(t).select()` silently stops at 1000 rows (the
// project's max-rows), so anything computed from "all rows" is quietly wrong
// once a table grows past it (audit L-01: money in hand summed a truncated
// ledger). `makeQuery` must build a FRESH, fully ordered query each call —
// include a unique tiebreaker (e.g. id) in the ordering, or offset paging can
// skip or repeat rows.

const PAGE = 1000;

// Minimal structural type so any supabase-js filter builder fits.
interface RangeableQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

export async function fetchAllRows<T>(makeQuery: () => RangeableQuery<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
