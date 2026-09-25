/**
 * The operator-corpus copy index for evaluation (ADR-0082, C0.4). Built once per process and database from
 * the voice-eligible main-story chapters in `corpus.chapters`, so it works from the permanent database
 * after the source files are gone. A database without the corpus schema or without chapters yields no
 * index, and the check is then a recorded no-op rather than an error.
 */
import { corpusChapters, type Pool } from '@yeonjae/db';
import { CorpusCopyIndex } from '@yeonjae/prose';

const cache = new WeakMap<Pool, Map<number, Promise<CorpusCopyIndex | undefined>>>();

export function corpusCopyIndexFor(
  pool: Pool,
  minChars: number,
): Promise<CorpusCopyIndex | undefined> {
  let byWindow = cache.get(pool);
  if (!byWindow) {
    byWindow = new Map();
    cache.set(pool, byWindow);
  }
  let pending = byWindow.get(minChars);
  if (!pending) {
    pending = corpusChapters(pool)
      .then((rows) =>
        rows.length === 0
          ? undefined
          : CorpusCopyIndex.build(
              rows.map((r) => ({
                id: `${r.book_title} ${String(r.position ?? 0)}화`,
                text: r.text,
              })),
              minChars,
            ),
      )
      .catch(() => undefined);
    byWindow.set(minChars, pending);
  }
  return pending;
}
