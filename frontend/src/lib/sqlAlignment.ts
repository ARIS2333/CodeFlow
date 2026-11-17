/** Align semantic phases without pretending differently ordered operations coincide. */
export function alignSqlSteps<T extends { phase: string }>(left: T[], right: T[]) {
  const lengths = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    lengths[i][j] = left[i].phase === right[j].phase ? 1 + lengths[i + 1][j + 1]
      : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  }
  const aligned: Array<{ left?: T; right?: T }> = [];
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].phase === right[j].phase) {
      aligned.push({ left: left[i++], right: right[j++] });
    } else if (i < left.length && (j === right.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      aligned.push({ left: left[i++] });
    } else aligned.push({ right: right[j++] });
  }
  return aligned;
}
