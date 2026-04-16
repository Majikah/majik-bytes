// ─────────────────────────────────────────────────────────────────────────────
// Error class
// ─────────────────────────────────────────────────────────────────────────────

export type MajikBytesErrorCode =
  | "INVALID_INPUT"
  | "CORRUPT_DATA"
  | "TYPE_MISMATCH"
  | "NOT_IMPLEMENTED"
  | "ASSERTION_FAILED";

export class MajikBytesError extends Error {
  readonly code: MajikBytesErrorCode;
  constructor(message: string, code: MajikBytesErrorCode) {
    super(`[MajikBytes] ${message}`);
    this.name = "MajikBytesError";
    this.code = code;
  }
}