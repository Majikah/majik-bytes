// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FileMeta {
  filename: string;
  mimetype: string;
}

export interface PrefixedPayload {
  prefixed: Uint8Array;
  sourceType: MajikBytesSourceType;
  fileMeta?: FileMeta;
}

export interface MajikBytesJSON {
  /** Base-64 encoded raw bytes (includes 2-byte prefix) */
  data: string;
  /** Byte length of the prefixed payload */
  length: number;
}

export interface PNGDimensions {
  width: number;
  height: number;
  dataPixels: number;
  dataRows: number;
}

export interface MajikBytesValidationResult {
  isValid: boolean;
  message: string;
}

/**
 * All source types MajikBytes can normalise from and restore to.
 *
 * Stored as the first byte of every prefixed payload:
 *   0x00  string
 *   0x01  json          (any JSON-serialisable object / array)
 *   0x02  uint8array
 *   0x03  arraybuffer
 *   0x04  blob
 *   0x05  file          (filename + mimetype stored in prefix header)
 *   0x06  number
 *   0x07  bigint
 *   0x08  boolean
 */
export type MajikBytesSourceType =
  | "string"
  | "json"
  | "uint8array"
  | "arraybuffer"
  | "blob"
  | "file"
  | "number"
  | "bigint"
  | "boolean";
