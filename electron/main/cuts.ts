import type { CutRange } from '../../shared/types';

export function normalizeCuts(input: unknown, duration: number): CutRange[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('La duración del video no es válida.');
  if (!Array.isArray(input) || input.length > 32) throw new Error('La lista de cortes no es válida.');
  const ranges = input.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Hay un corte inválido.');
    const { start, end } = value as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < .05 || end > duration + .05) throw new Error('Hay un corte fuera de la duración del video.');
    return { start: Math.max(0, start), end: Math.min(duration, end) };
  }).sort((a, b) => a.start - b.start);
  const merged: CutRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + .01) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function keptSegments(cuts: CutRange[], duration: number): CutRange[] {
  const kept: CutRange[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start - cursor >= .05) kept.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (duration - cursor >= .05) kept.push({ start: cursor, end: duration });
  if (!kept.length) throw new Error('No puedes eliminar todo el video.');
  return kept;
}
