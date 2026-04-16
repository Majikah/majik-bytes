// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

import { MajikBytesSourceType } from "./types";

export const HASH_BYTE_LENGTH = 64; // SHA-3-512 output size in bytes
export const CURRENT_VERSION = 1; // prefix version byte — bump when prefix layout changes

/** Tag byte values — must stay stable across versions. */
export const TYPE_TAG: Record<MajikBytesSourceType, number> = {
  string: 0x00,
  json: 0x01,
  uint8array: 0x02,
  arraybuffer: 0x03,
  blob: 0x04,
  file: 0x05,
  number: 0x06,
  bigint: 0x07,
  boolean: 0x08,
};

export const TAG_TO_TYPE: Record<number, MajikBytesSourceType> =
  Object.fromEntries(
    Object.entries(TYPE_TAG).map(([k, v]) => [v, k as MajikBytesSourceType]),
  );

/**
 * Prefix layout (minimum 2 bytes, variable for "file"):
 *
 *   Byte 0   : type tag  (TYPE_TAG value)
 *   Byte 1   : version   (CURRENT_VERSION)
 *   --- for type "file" only ---
 *   Bytes 2-3: filename length N as big-endian Uint16
 *   Bytes 4-(4+N-1): filename UTF-8
 *   Bytes (4+N)-(4+N+1): mimetype length M as big-endian Uint16
 *   Bytes (4+N+2)-(4+N+2+M-1): mimetype UTF-8
 *   --- payload follows ---
 */
export const PREFIX_BASE_LENGTH = 2;
