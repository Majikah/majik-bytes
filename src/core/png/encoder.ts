// ─────────────────────────────────────────────────────────────────────────────
// PNG encoder
// ─────────────────────────────────────────────────────────────────────────────

import { concatBuffers } from "../utils";
import { adler32, crc32 } from "./utils";

export async function encodePNG(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = buildIHDR(width, height);

  const rowBytes = width * 4;
  const scanBuf = new ArrayBuffer(height * (1 + rowBytes));
  const scanlines = new Uint8Array(scanBuf) as Uint8Array;

  for (let y = 0; y < height; y++) {
    const dest = y * (1 + rowBytes);
    scanlines[dest] = 0x00;
    scanlines.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), dest + 1);
  }

  const compressed = await deflateRaw(scanlines);
  const zlibData = wrapZlib(compressed, scanlines);
  const idat = buildChunk("IDAT", zlibData);
  const iend = buildChunk(
    "IEND",
    new Uint8Array(new ArrayBuffer(0)) as Uint8Array,
  );

  return concatBuffers([sig, ihdr, idat, iend]);
}

export function buildIHDR(width: number, height: number): Uint8Array {
  const buf = new ArrayBuffer(13);
  const data = new Uint8Array(buf) as Uint8Array;
  const view = new DataView(buf);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return buildChunk("IHDR", data);
}

export function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type) as Uint8Array;
  const length = data.byteLength;
  const buf = new ArrayBuffer(12 + length);
  const chunk = new Uint8Array(buf) as Uint8Array;
  const view = new DataView(buf);

  view.setUint32(0, length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcInput = new Uint8Array(new ArrayBuffer(4 + length)) as Uint8Array;
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + length, crc32(crcInput));
  return chunk;
}

export async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  (async () => {
    await writer.write(input as BufferSource);
    await writer.close();
  })();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBuffers(chunks);
}

export function wrapZlib(
  compressed: Uint8Array,
  original: Uint8Array,
): Uint8Array {
  const buf = new ArrayBuffer(2 + compressed.byteLength + 4);
  const out = new Uint8Array(buf) as Uint8Array;
  const view = new DataView(buf);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(compressed, 2);
  view.setUint32(2 + compressed.byteLength, adler32(original));
  return out;
}
