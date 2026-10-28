import type { CutRange } from '../../shared/types';

export function mergeCuts(ranges: CutRange[]) {
  const merged: CutRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + .05) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function skipRemovedTime(time: number, cuts: CutRange[]) {
  const cut = cuts.find(range => time >= range.start - .02 && time < range.end - .02);
  return cut ? cut.end : time;
}
