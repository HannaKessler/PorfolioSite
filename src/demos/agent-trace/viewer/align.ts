/**
 * Needleman–Wunsch global alignment of two token sequences, used to line up the
 * steps of two runs so divergences show as gaps.
 */
export type Aligned<T> = [T | null, T | null];

export function align<T>(a: T[], b: T[], key: (x: T) => string, scores = { match: 2, mismatch: -1, gap: -1 }): Aligned<T>[] {
  const n = a.length, m = b.length;
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) score[i][0] = i * scores.gap;
  for (let j = 1; j <= m; j++) score[0][j] = j * scores.gap;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = score[i - 1][j - 1] + (key(a[i - 1]) === key(b[j - 1]) ? scores.match : scores.mismatch);
      score[i][j] = Math.max(diag, score[i - 1][j] + scores.gap, score[i][j - 1] + scores.gap);
    }
  }
  const out: Aligned<T>[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + (key(a[i - 1]) === key(b[j - 1]) ? scores.match : scores.mismatch)) {
      out.push([a[--i], b[--j]]);
    } else if (i > 0 && score[i][j] === score[i - 1][j] + scores.gap) {
      out.push([a[--i], null]);
    } else {
      out.push([null, b[--j]]);
    }
  }
  return out.reverse();
}
