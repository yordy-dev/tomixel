import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Recording } from '../../shared/types';
import { normalizeCuts } from './cuts';
import { atomicJSON } from './settings';
import { reserveDuration } from './webm';

const uuid = /^[a-f0-9-]{36}$/;
export function validTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f]/.test(value)) throw new Error('Escribe un nombre de 1 a 160 caracteres.');
  return value.trim();
}
export class RecordingStore {
  private entries: Recording[] = [];
  private active = new Map<string, fs.FileHandle>();
  private headers = new Map<string, { offset: number; scale: number } | null>();
  constructor(public root: string) {}
  private get index() { return path.join(this.root, 'recordings.json'); }
  private directory(saved: boolean) { return path.join(this.root, saved ? 'recordings' : '.pending'); }
  async init() {
    await fs.mkdir(this.directory(true), { recursive: true });
    await fs.mkdir(this.directory(false), { recursive: true });
    await fs.access(this.root, constants.W_OK);
    try {
      const data = JSON.parse(await fs.readFile(this.index, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Índice inválido');
      this.entries = data.filter((r: Recording) => uuid.test(r.id) && typeof r.filename === 'string' && /^[\w.-]+\.webm$/.test(r.filename) && typeof r.title === 'string' && typeof r.saved === 'boolean').map((r: Recording) => ({ ...r, recovered: !!r.recovered, cuts: normalizeCuts(r.cuts || [], Math.max(.1, r.duration || .1)) }));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        await fs.copyFile(this.index, `${this.index}.${Date.now()}.backup`);
        throw new Error('El índice de la biblioteca está dañado. Se conservó una copia; no se modificaron los videos.');
      }
    }
    // Recover pending chunks and unindexed saved files after an interrupted session.
    let recovered = 0;
    for (const saved of [false, true]) {
      for (const filename of await fs.readdir(this.directory(saved))) {
        if (!/^[\w.-]+\.webm$/.test(filename) || this.entries.some(r => r.filename === filename && r.saved === saved)) continue;
        const stat = await fs.stat(path.join(this.directory(saved), filename));
        if (!stat.size) continue;
        this.entries.push({ id: randomUUID(), title: 'Grabación recuperada', filename, saved, size: stat.size, duration: 0, createdAt: stat.birthtime.toISOString(), recovered: true, cuts: [] });
        recovered++;
      }
    }
    this.entries = (await Promise.all(this.entries.map(async r => await fs.access(this.file(r)).then(() => r, () => null)))).filter((r): r is Recording => r !== null);
    await this.persist();
    return recovered;
  }
  private persist() { return atomicJSON(this.index, this.entries); }
  private find(id: string) { const r = this.entries.find(r => r.id === id); if (!r || !uuid.test(id)) throw new Error('Grabación no encontrada.'); return r; }
  private file(r: Recording) { return path.join(this.directory(r.saved), r.filename); }
  getPath(id: string) { return this.file(this.find(id)); }
  list() { return [...this.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async begin() {
    if (this.active.size) throw new Error('Ya hay una grabación en curso.');
    const id = randomUUID();
    const file = path.join(this.directory(false), `${id}.webm`);
    this.active.set(id, await fs.open(file, 'wx'));
    return id;
  }
  async append(id: string, value: unknown) {
    const handle = this.active.get(id);
    if (!handle || !(value instanceof ArrayBuffer) || value.byteLength > 32 * 1024 * 1024) throw new Error('Fragmento de grabación inválido.');
    let buffer: Buffer = Buffer.from(value);
    if (!this.headers.has(id)) {
      const header = reserveDuration(buffer);
      this.headers.set(id, header ? { offset: header.offset, scale: header.scale } : null);
      if (header) buffer = header.buffer;
    }
    let written = 0;
    while (written < buffer.length) {
      const result = await handle.write(buffer, written, buffer.length - written);
      if (!result.bytesWritten) throw new Error('No se pudo escribir el video.');
      written += result.bytesWritten;
    }
  }
  async abort(id: string) {
    const handle = this.active.get(id); if (!handle) return;
    const stat = await handle.stat();
    if (stat.size) { await this.finish(id, 0); return; }
    await handle.close(); this.active.delete(id); this.headers.delete(id);
    await fs.unlink(path.join(this.directory(false), `${id}.webm`));
  }
  async finish(id: string, duration: number) {
    if (!Number.isFinite(duration) || duration < 0 || duration > 604800) throw new Error('Duración inválida.');
    const handle = this.active.get(id);
    if (!handle) throw new Error('No hay una grabación activa.');
    const header = this.headers.get(id);
    if (header) { const value = Buffer.alloc(8); value.writeDoubleBE(Math.max(.001, duration) * 1e9 / header.scale); await handle.write(value, 0, 8, header.offset); }
    await handle.sync(); await handle.close(); this.active.delete(id); this.headers.delete(id);
    const filename = `${id}.webm`;
    const stat = await fs.stat(path.join(this.directory(false), filename));
    if (!stat.size) { await fs.unlink(path.join(this.directory(false), filename)); throw new Error('No se recibieron datos de video.'); }
    const date = new Date();
    const title = `Grabación ${date.toLocaleDateString('sv-SE')} ${date.toTimeString().slice(0, 5).replace(':', '-')}`;
    const r: Recording = { id, title, filename, createdAt: date.toISOString(), duration, size: stat.size, saved: false, recovered: false, cuts: [] };
    this.entries.push(r); await this.persist(); return r;
  }
  async save(id: string, title: unknown) {
    const r = this.find(id); const name = validTitle(title);
    if (r.saved) return this.rename(id, name);
    const filename = `Recording_${r.createdAt.replace(/[:.]/g, '-')}_${id.slice(0, 8)}.webm`;
    const from = this.file(r); const to = path.join(this.directory(true), filename);
    await fs.rename(from, to);
    const previous = { ...r };
    Object.assign(r, { filename, title: name, saved: true, recovered: false });
    try { await this.persist(); } catch (e) { Object.assign(r, previous); await fs.rename(to, from); throw e; }
    return { ...r };
  }
  async rename(id: string, title: unknown) {
    const r = this.find(id); const previous = { title: r.title, recovered: r.recovered }; r.title = validTitle(title); r.recovered = false;
    try { await this.persist(); } catch (e) { r.title = previous.title; r.recovered = previous.recovered; throw e; }
    return { ...r };
  }
  async saveEdits(id: string, input: unknown) {
    const r = this.find(id); const previous = r.cuts || [];
    r.cuts = normalizeCuts(input, Math.max(.1, r.duration || .1));
    try { await this.persist(); } catch (e) { r.cuts = previous; throw e; }
    return { ...r, cuts: [...r.cuts] };
  }
  async remove(id: string) {
    const r = this.find(id); const file = this.file(r); const tomb = `${file}.deleting`;
    await fs.rename(file, tomb);
    this.entries = this.entries.filter(entry => entry.id !== id);
    try { await this.persist(); } catch (e) { this.entries.push(r); await fs.rename(tomb, file); throw e; }
    await fs.unlink(tomb);
    return true;
  }
  async closeHandles() { for (const handle of this.active.values()) await handle.close().catch(() => {}); this.active.clear(); }
}
