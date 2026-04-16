// ─────────────────────────────────────────────────────────────────────────────
// Helpers – RGB pixel packing
// ─────────────────────────────────────────────────────────────────────────────

import { MajikBytesError } from "../errors";

/**
 * Writes `src` bytes into `dest` starting at pixel `pixelOffset`.
 * Packs 3 bytes per pixel into R, G, B. Alpha is left untouched (caller
 * must pre-fill to 255).
 */
export function writeRGB(
  dest: Uint8Array,
  src: Uint8Array,
  pixelOffset: number,
): void {
  for (let i = 0, j = pixelOffset * 4; i < src.byteLength; j += 4) {
    dest[j] = src[i++];
    dest[j + 1] = i < src.byteLength ? src[i++] : 0;
    dest[j + 2] = i < src.byteLength ? src[i++] : 0;
  }
}

/**
 * Reads `byteCount` bytes from `src` starting at pixel `pixelOffset`.
 * Reads only R, G, B per pixel — alpha is always skipped.
 */
export function readRGB(
  src: Uint8Array,
  pixelOffset: number,
  byteCount: number,
): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(byteCount));
  for (let i = 0, j = pixelOffset * 4; i < byteCount; j += 4) {
    out[i++] = src[j];
    if (i < byteCount) out[i++] = src[j + 1];
    if (i < byteCount) out[i++] = src[j + 2];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checksums
// ─────────────────────────────────────────────────────────────────────────────

export function adler32(data: Uint8Array): number {
  let s1 = 1,
    s2 = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
