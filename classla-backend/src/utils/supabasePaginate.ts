/**
 * Fetches all rows from a Supabase/PostgREST query by paginating with .range().
 *
 * PostgREST silently caps results at 1000 rows. This utility loops until all
 * rows are fetched. For the common case (<1000 rows) it's a single round-trip.
 *
 * @param queryFactory - A function that returns a fresh PostgREST query builder
 *                       (must be callable multiple times so each page gets its own .range()).
 * @param pageSize     - Number of rows per page (default 1000, matching PostgREST default limit).
 * @returns All rows concatenated.
 */
export async function fetchAllPages<T = any>(
  queryFactory: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }> },
  pageSize: number = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await queryFactory().range(
      offset,
      offset + pageSize - 1
    );

    if (error) throw error;

    const rows = data ?? [];
    allRows.push(...rows);

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}
