// Chromium emits a streaming Segment with no duration. Insert an 11-byte
// Duration element into its first Info, then patch only that float on stop.
// No whole-video buffering, remuxing, transcoding, or extension substitution.
function vint(buffer: Buffer, offset: number) {
  const first = buffer[offset]; if (!first) return null;
  let length = 1; while (length <= 8 && !(first & (1 << (8 - length)))) length++;
  if (length > 8 || offset + length > buffer.length) return null;
  let value = BigInt(first & ((1 << (8 - length)) - 1));
  for (let i = 1; i < length; i++) value = (value << 8n) | BigInt(buffer[offset + i]);
  return { length, value, unknown: value === (1n << BigInt(7 * length)) - 1n };
}
function element(buffer: Buffer, offset: number) {
  const id = vint(buffer, offset); if (!id || id.length > 4) return null;
  const sizeOffset = offset + id.length, size = vint(buffer, sizeOffset); if (!size) return null;
  return { id: buffer.readUIntBE(offset, id.length), sizeOffset, size, data: sizeOffset + size.length, end: sizeOffset + size.length + Number(size.value) };
}
export function reserveDuration(input: Buffer): { buffer: Buffer; offset: number; scale: number } | null {
  const ebml = element(input, 0); if (!ebml || ebml.id !== 0x1a45dfa3) return null;
  const segment = element(input, ebml.end);
  if (!segment || segment.id !== 0x18538067 || !segment.size.unknown) return null;
  const info = element(input, segment.data);
  // Do not shift an indexed file. This is specifically Chromium's live WebM layout.
  if (!info || info.id !== 0x1549a966 || info.end > input.length || info.size.unknown) return null;
  let scale = 1e6;
  for (let position = info.data; position < info.end;) {
    const child = element(input, position); if (!child || child.end > info.end) return null;
    if (child.id === 0x2ad7b1 && child.size.value <= 6n) scale = input.readUIntBE(child.data, Number(child.size.value));
    if (child.id === 0x4489) return child.size.value === 8n ? { buffer: input, offset: child.data, scale } : null;
    position = child.end;
  }
  if (scale <= 0) return null;
  const size = info.size.value + 11n;
  if (size >= (1n << BigInt(7 * info.size.length)) - 1n) return null;
  const duration = Buffer.from([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
  const buffer = Buffer.concat([input.subarray(0, info.end), duration, input.subarray(info.end)]);
  let encoded = size | (1n << BigInt(7 * info.size.length));
  for (let i = info.size.length - 1; i >= 0; i--) { buffer[info.sizeOffset + i] = Number(encoded & 255n); encoded >>= 8n; }
  return { buffer, offset: info.end + 3, scale };
}
