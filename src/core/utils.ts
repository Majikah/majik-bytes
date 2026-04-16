// ─────────────────────────────────────────────────────────────────────────────
// Helpers – prefix encode / decode
// ─────────────────────────────────────────────────────────────────────────────

import { CURRENT_VERSION, PREFIX_BASE_LENGTH, TAG_TO_TYPE, TYPE_TAG } from "./constants";
import { MajikBytesError } from "./errors";
import { FileMeta, MajikBytesSourceType } from "./types";





interface DecodedPrefix {
  sourceType: MajikBytesSourceType;
  version: number;
  fileMeta?: FileMeta;
  /** Byte offset into the prefixed buffer where the raw payload starts */
  payloadOffset: number;
}

export function encodePrefix(
  raw: Uint8Array,
  sourceType: MajikBytesSourceType,
  fileMeta?: FileMeta,
): Uint8Array {
  const enc = new TextEncoder();
  const tagByte = TYPE_TAG[sourceType];
  const verByte = CURRENT_VERSION;

  if (sourceType === "file") {
    const nameBytes = enc.encode(fileMeta?.filename ?? "blob");
    const mimeBytes = enc.encode(
      fileMeta?.mimetype ?? "application/octet-stream",
    );

    // [tag][ver][nameLen:2][name][mimeLen:2][mime][...raw]
    const headerLen =
      PREFIX_BASE_LENGTH + 2 + nameBytes.byteLength + 2 + mimeBytes.byteLength;
    const buf = new ArrayBuffer(headerLen + raw.byteLength);
    const out = new Uint8Array(buf) as Uint8Array;
    const view = new DataView(buf);

    out[0] = tagByte;
    out[1] = verByte;
    view.setUint16(2, nameBytes.byteLength);
    out.set(nameBytes, 4);
    view.setUint16(4 + nameBytes.byteLength, mimeBytes.byteLength);
    out.set(mimeBytes, 4 + nameBytes.byteLength + 2);
    out.set(raw, headerLen);
    return out;
  }

  // All other types: [tag][ver][...raw]
  const buf = new ArrayBuffer(PREFIX_BASE_LENGTH + raw.byteLength);
  const out = new Uint8Array(buf) as Uint8Array;
  out[0] = tagByte;
  out[1] = verByte;
  out.set(raw, PREFIX_BASE_LENGTH);
  return out;
}

export function decodePrefix(prefixed: Uint8Array): DecodedPrefix {
  if (prefixed.byteLength < PREFIX_BASE_LENGTH) {
    throw new MajikBytesError("Prefixed payload too short", "CORRUPT_DATA");
  }

  const tagByte = prefixed[0];
  const version = prefixed[1];

  const sourceType = TAG_TO_TYPE[tagByte];
  if (sourceType === undefined) {
    throw new MajikBytesError(
      `Unknown type tag: 0x${tagByte.toString(16).padStart(2, "0")}`,
      "CORRUPT_DATA",
    );
  }

  if (sourceType !== "file") {
    return { sourceType, version, payloadOffset: PREFIX_BASE_LENGTH };
  }

  // File: decode variable-length header
  const view = new DataView(
    prefixed.buffer,
    prefixed.byteOffset,
    prefixed.byteLength,
  );
  const dec = new TextDecoder();
  const nameLen = view.getUint16(2);
  const nameBytes = prefixed.subarray(4, 4 + nameLen);
  const mimeOffset = 4 + nameLen;
  const mimeLen = view.getUint16(mimeOffset);
  const mimeBytes = prefixed.subarray(mimeOffset + 2, mimeOffset + 2 + mimeLen);
  const payloadOffset = mimeOffset + 2 + mimeLen;

  return {
    sourceType,
    version,
    fileMeta: {
      filename: dec.decode(nameBytes),
      mimetype: dec.decode(mimeBytes),
    },
    payloadOffset,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – ArrayBuffer
// ─────────────────────────────────────────────────────────────────────────────

export function toConcreteUint8Array(src: Uint8Array): Uint8Array {
  const buf = new ArrayBuffer(src.byteLength);
  const out = new Uint8Array(buf);
  out.set(src);
  return out as Uint8Array;
}


// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

export function concatBuffers(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.byteLength, 0);
  const buf = new ArrayBuffer(total);
  const out = new Uint8Array(buf) as Uint8Array;
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.byteLength;
  }
  return out;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  try {
    const binary = atob(b64);
    const buf = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new MajikBytesError("Invalid base-64 string", "CORRUPT_DATA");
  }
}

export function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}





// ─────────────────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────────────────

export function assertDefined(value: unknown, label: string): void {
  if (value === undefined || value === null) {
    throw new MajikBytesError(`${label} must not be null or undefined`, "INVALID_INPUT");
  }
}

export function assertNonEmpty(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength === 0) {
    throw new MajikBytesError(`${label}: byte array must not be empty`, "INVALID_INPUT");
  }
}

export function assertString(value: unknown, label: string): void {
  if (typeof value !== "string") {
    throw new MajikBytesError(`${label} must be a string, got ${typeof value}`, "ASSERTION_FAILED");
  }
}

export function assertNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MajikBytesError(`${label} must be a finite number, got ${typeof value}`, "ASSERTION_FAILED");
  }
}

export function assertPlainObject(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MajikBytesError(`${label} must be a plain object`, "ASSERTION_FAILED");
  }
}