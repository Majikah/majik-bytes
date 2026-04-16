/**
 * MajikBytes
 * TypeScript utility class for lossless byte ↔ media conversion.
 *
 * Supported output formats (planned):
 *   • PNG  – RGB pixel encoding (alpha channel forced to 255), near-square,
 *            with length-encoded sentinel row + SHA-3-512 footer strip
 *   • WAV  – PCM audio (stub, future)
 *   • TXT  – Base-64 encoded plain text (stub, future)
 *
 * Dependencies:
 *   @noble/hashes  –  npm i @noble/hashes
 *
 * Encoding scheme (PNG):
 *   Each byte of the payload is packed into the R, G, or B channel of each
 *   pixel.  The alpha channel is ALWAYS set to 255 (fully opaque) on every
 *   pixel — this prevents any browser or canvas API from applying alpha
 *   premultiplication, which would corrupt data bytes carried in RGB.
 *
 *   3 payload bytes → 1 pixel  (R=byte[0], G=byte[1], B=byte[2], A=255)
 *
 * Image layout (rows, top → bottom):
 *   [data rows]    – RGB-packed pixels carrying the raw byte payload
 *   [sentinel row] – First pixel encodes original byte length as a big-endian
 *                    Uint32 across R/G/B/A (alpha forced 255 after write).
 *                    All remaining pixels in this row are (0, 0, 0, 255).
 *   [hash row]     – SHA-3-512 of the raw payload (64 bytes) packed as RGB,
 *                    alpha=255, zero-padded to fill the row width.
 *
 * Compression note:
 *   PNG mandates zlib/deflate (RFC 1950) inside IDAT chunks — this is
 *   non-negotiable per the PNG spec.  CompressionStream("deflate-raw") is
 *   used here and is correct.
 */

import { sha3_512 } from "@noble/hashes/sha3.js";
import {
  FileMeta,
  MajikBytesJSON,
  MajikBytesSourceType,
  MajikBytesValidationResult,
  PNGDimensions,
  PrefixedPayload,
} from "./types";
import {
  assertDefined,
  assertNonEmpty,
  assertNumber,
  assertPlainObject,
  assertString,
  base64ToUint8,
  decodePrefix,
  encodePrefix,
  toConcreteUint8Array,
  uint8ToBase64,
  uint8ToHex,
} from "./utils";
import { MajikBytesError } from "./errors";
import { CURRENT_VERSION, HASH_BYTE_LENGTH } from "./constants";
import { readRGB, writeRGB } from "./png/utils";
import { encodePNG } from "./png/encoder";

// ─────────────────────────────────────────────────────────────────────────────
// MajikBytes
// ─────────────────────────────────────────────────────────────────────────────

export class MajikBytes {
  /**
   * Prefixed payload: [typeTag][version][...fileMeta?][...rawBytes]
   * This is what gets encoded into PNG / TXT.
   */
  private readonly _prefixed: Uint8Array;

  /** The original source type, recovered from the prefix tag. */
  readonly sourceType: MajikBytesSourceType;

  /** Prefix format version. Always 1 for now. */
  readonly version: number;

  /** File metadata — only present when sourceType === "file". */
  readonly fileMeta?: FileMeta;

  // ── Constructor (private) ─────────────────────────────────────────────────

  private constructor(
    prefixed: Uint8Array,
    sourceType: MajikBytesSourceType,
    version: number,
    fileMeta?: FileMeta,
  ) {
    assertNonEmpty(prefixed, "MajikBytes constructor");
    this._prefixed = toConcreteUint8Array(prefixed);
    this.sourceType = sourceType;
    this.version = version;
    this.fileMeta = fileMeta;
  }

  // ── Public accessors ──────────────────────────────────────────────────────

  /** Returns a defensive copy of the raw (un-prefixed) payload bytes. */
  get bytes(): Uint8Array {
    const { payloadOffset } = decodePrefix(this._prefixed);
    const raw = this._prefixed.subarray(payloadOffset);
    return toConcreteUint8Array(raw);
  }

  /** Returns a defensive copy of the full prefixed payload. */
  get prefixedBytes(): Uint8Array {
    return toConcreteUint8Array(this._prefixed);
  }

  /** Byte length of the raw (un-prefixed) payload. */
  get byteLength(): number {
    return this.bytes.byteLength;
  }

  /** Byte length of the full prefixed payload. */
  get prefixedByteLength(): number {
    return this._prefixed.byteLength;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Source type identification helpers
  // ─────────────────────────────────────────────────────────────────────────

  isString(): this is MajikBytes & { sourceType: "string" } {
    return this.sourceType === "string";
  }
  isJSON(): this is MajikBytes & { sourceType: "json" } {
    return this.sourceType === "json";
  }
  isUint8Array(): this is MajikBytes & { sourceType: "uint8array" } {
    return this.sourceType === "uint8array";
  }
  isArrayBuffer(): this is MajikBytes & { sourceType: "arraybuffer" } {
    return this.sourceType === "arraybuffer";
  }
  isBlob(): this is MajikBytes & { sourceType: "blob" } {
    return this.sourceType === "blob";
  }
  isFile(): this is MajikBytes & { sourceType: "file" } {
    return this.sourceType === "file";
  }
  isNumber(): this is MajikBytes & { sourceType: "number" } {
    return this.sourceType === "number";
  }
  isBigInt(): this is MajikBytes & { sourceType: "bigint" } {
    return this.sourceType === "bigint";
  }
  isBoolean(): this is MajikBytes & { sourceType: "boolean" } {
    return this.sourceType === "boolean";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transformer methods — restore to original type
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Restores the original value as its source type.
   * Throws MajikBytesError with code "TYPE_MISMATCH" if the stored type does
   * not match the requested restore method.
   */

  toString(): string {
    this._assertType("string", "toString");
    return new TextDecoder().decode(this.bytes);
  }

  toStringValue(): string {
    return this.toString();
  }

  toJSON(): MajikBytesJSON {
    return {
      data: uint8ToBase64(this._prefixed),
      length: this._prefixed.byteLength,
    };
  }

  /** Restores a JSON-serialisable value. */
  toJSONValue<T = unknown>(): T {
    this._assertType("json", "toJSONValue");
    const text = new TextDecoder().decode(this.bytes);
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new MajikBytesError(
        `toJSONValue: failed to parse JSON — ${(err as Error).message}`,
        "CORRUPT_DATA",
      );
    }
  }

  toUint8Array(): Uint8Array {
    this._assertType("uint8array", "toUint8Array");
    return this.bytes;
  }

  toArrayBuffer(): ArrayBuffer {
    this._assertType("arraybuffer", "toArrayBuffer");
    return this.bytes.buffer as ArrayBuffer;
  }

  toBlob(): Blob {
    this._assertType("blob", "toBlob");
    return new Blob([this.bytes as BlobPart], {
      type: "application/octet-stream",
    });
  }

  toFile(): File {
    this._assertType("file", "toFile");
    const filename = this.fileMeta?.filename ?? "blob";
    const mimetype = this.fileMeta?.mimetype ?? "application/octet-stream";
    return new File([this.bytes as BlobPart], filename, { type: mimetype });
  }

  toNumber(): number {
    this._assertType("number", "toNumber");
    const n = Number(new TextDecoder().decode(this.bytes));
    if (!Number.isFinite(n)) {
      throw new MajikBytesError(
        "toNumber: stored value is not a finite number",
        "CORRUPT_DATA",
      );
    }
    return n;
  }

  toBigInt(): bigint {
    this._assertType("bigint", "toBigInt");
    try {
      return BigInt(new TextDecoder().decode(this.bytes));
    } catch (err) {
      throw new MajikBytesError(
        `toBigInt: ${(err as Error).message}`,
        "CORRUPT_DATA",
      );
    }
  }

  toBoolean(): boolean {
    this._assertType("boolean", "toBoolean");
    return new TextDecoder().decode(this.bytes) === "true";
  }

  /**
   * Restores the value as its original type without needing to know what
   * it was. Returns `unknown` — caller can narrow with the `is*()` guards.
   */
  async restore(): Promise<unknown> {
    switch (this.sourceType) {
      case "string":
        return this.toStringValue();
      case "json":
        return this.toJSONValue();
      case "uint8array":
        return this.toUint8Array();
      case "arraybuffer":
        return this.toArrayBuffer();
      case "blob":
        return this.toBlob();
      case "file":
        return this.toFile();
      case "number":
        return this.toNumber();
      case "bigint":
        return this.toBigInt();
      case "boolean":
        return this.toBoolean();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static factory
  // ─────────────────────────────────────────────────────────────────────────

  static async create(input: unknown): Promise<MajikBytes> {
    assertDefined(input, "MajikBytes.create input");
    const { prefixed, sourceType, fileMeta } =
      await MajikBytes._normalise(input);
    assertNonEmpty(prefixed, "MajikBytes.create – prefixed bytes");
    return new MajikBytes(prefixed, sourceType, CURRENT_VERSION, fileMeta);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialisation — JSON
  // ─────────────────────────────────────────────────────────────────────────

  static fromJSON(json: unknown): MajikBytes {
    assertPlainObject(json, "MajikBytes.fromJSON");
    const obj = json as Record<string, unknown>;

    assertString(obj["data"], "MajikBytesJSON.data");
    assertNumber(obj["length"], "MajikBytesJSON.length");

    const prefixed = base64ToUint8(obj["data"] as string);

    if (prefixed.byteLength !== (obj["length"] as number)) {
      throw new MajikBytesError(
        `fromJSON length mismatch: declared ${obj["length"]}, decoded ${prefixed.byteLength}`,
        "CORRUPT_DATA",
      );
    }

    assertNonEmpty(prefixed, "MajikBytes.fromJSON – decoded bytes");
    const { sourceType, version, fileMeta } = decodePrefix(prefixed);
    return new MajikBytes(prefixed, sourceType, version, fileMeta);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialisation — PNG
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Encodes the prefixed payload into a lossless RGBA PNG.
   *
   * Encoding: 3 payload bytes per pixel (R, G, B). Alpha is always 255.
   *
   * Image layout (rows, top → bottom):
   *   [data rows]    – RGB-packed pixels carrying the prefixed payload
   *   [sentinel row] – First pixel R/G/B encodes payload length (big-endian
   *                    24-bit, max ~16 MB). Alpha = 255. Rest of row = 0.
   *   [hash row]     – SHA-3-512 of the prefixed payload, RGB-packed, alpha=255.
   */
  async toPNG(): Promise<Blob> {
    const payload = this._prefixed;
    const hash = sha3_512(payload);
    const { width, height } = MajikBytes._computeDimensions(payload.byteLength);

    const totalHeight = height + 2;
    const rowBytes = width * 4;

    const rgbaBuf = new ArrayBuffer(width * totalHeight * 4);
    const rgba = new Uint8Array(rgbaBuf) as Uint8Array;

    // Pre-fill alpha = 255 for every pixel
    for (let i = 3; i < rgba.byteLength; i += 4) rgba[i] = 255;

    // Data rows
    writeRGB(rgba, payload, 0);

    // Sentinel row — length packed into R, G, B of first pixel
    const sentinelRowStart = height * rowBytes;
    rgba[sentinelRowStart] = (payload.byteLength >> 16) & 0xff;
    rgba[sentinelRowStart + 1] = (payload.byteLength >> 8) & 0xff;
    rgba[sentinelRowStart + 2] = payload.byteLength & 0xff;
    rgba[sentinelRowStart + 3] = 255;

    // Hash row
    const hashRowStart = (height + 1) * rowBytes;
    const hashRowPixels = new Uint8Array(rgba.buffer, hashRowStart, rowBytes);
    writeRGB(hashRowPixels, hash, 0);

    const pngBytes = await encodePNG(rgba, width, totalHeight);
    return new Blob([pngBytes as BlobPart], { type: "image/png" });
  }

  /**
   * Decodes a PNG Blob previously produced by {@link toPNG} back into a
   * MajikBytes instance, restoring sourceType and fileMeta from the prefix.
   */
  static async fromPNG(blob: Blob): Promise<MajikBytes> {
    const { rgba, width, height } = await MajikBytes._decodePNGToRGBA(blob);

    if (height < 3) {
      throw new MajikBytesError(
        "PNG is too short to contain data + sentinel + hash rows",
        "INVALID_INPUT",
      );
    }

    const rowBytes = width * 4;

    // Locate sentinel row
    let sentinelRow = -1;
    let originalLength = 0;

    for (let y = height - 2; y >= 0; y--) {
      const rowStart = y * rowBytes;
      const r = rgba[rowStart];
      const g = rgba[rowStart + 1];
      const b = rgba[rowStart + 2];
      const possibleLength = (r << 16) | (g << 8) | b;

      if (possibleLength === 0) continue;

      let isSentinel = true;
      for (let i = 4; i < rowBytes; i += 4) {
        if (
          rgba[rowStart + i] !== 0 ||
          rgba[rowStart + i + 1] !== 0 ||
          rgba[rowStart + i + 2] !== 0
        ) {
          isSentinel = false;
          break;
        }
      }

      if (isSentinel) {
        sentinelRow = y;
        originalLength = possibleLength;
        break;
      }
    }

    if (sentinelRow === -1) {
      throw new MajikBytesError(
        "fromPNG: sentinel row not found — image was not produced by toPNG",
        "INVALID_INPUT",
      );
    }

    const hashRowIndex = sentinelRow + 1;
    if (hashRowIndex >= height) {
      throw new MajikBytesError(
        "fromPNG: no hash row present after sentinel",
        "INVALID_INPUT",
      );
    }

    // Extract stored hash
    const hashRowStart = hashRowIndex * rowBytes;
    const hashRowPixels = new Uint8Array(
      rgba.buffer,
      rgba.byteOffset + hashRowStart,
      rowBytes,
    );
    const storedHash = readRGB(hashRowPixels, 0, HASH_BYTE_LENGTH);

    // Extract prefixed payload
    const prefixed = readRGB(rgba, 0, originalLength);

    // Verify hash
    const digest = sha3_512(prefixed);
    if (!MajikBytes._constantTimeEqual(digest, storedHash)) {
      throw new MajikBytesError(
        "fromPNG: SHA-3-512 hash mismatch — payload is corrupt or tampered",
        "INVALID_INPUT",
      );
    }

    const { sourceType, version, fileMeta } = decodePrefix(prefixed);
    return new MajikBytes(prefixed, sourceType, version, fileMeta);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialisation — TXT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Encodes the prefixed payload as a base-64 text file.
   *
   * TXT file layout (plain text):
   *   Line 1: "MAJIKBYTES:v{version}"          — magic header
   *   Line 2: base-64 encoded prefixed payload  — the data
   *   Line 3: hex-encoded SHA-3-512 of the prefixed payload  — integrity check
   *
   * Returns a Blob with mime type "text/plain".
   */
  async toTXT(): Promise<Blob> {
    const payload = this._prefixed;
    const hash = sha3_512(payload);
    const hashHex = uint8ToHex(hash);
    const b64 = uint8ToBase64(payload);

    const content = [`MAJIKBYTES:v${CURRENT_VERSION}`, b64, hashHex].join("\n");

    return new Blob([content], { type: "text/plain" });
  }

  /**
   * Decodes a TXT Blob previously produced by {@link toTXT} back into a
   * MajikBytes instance, restoring sourceType and fileMeta from the prefix.
   */
  static async fromTXT(blob: Blob): Promise<MajikBytes> {
    const text = await MajikBytes._readBlobAsText(blob);
    const lines = text.split("\n");

    if (lines.length < 3) {
      throw new MajikBytesError(
        "fromTXT: file does not contain the expected 3-line structure",
        "INVALID_INPUT",
      );
    }

    // Validate magic header
    const magic = lines[0]!.trim();
    if (!magic.startsWith("MAJIKBYTES:v")) {
      throw new MajikBytesError(
        "fromTXT: missing MAJIKBYTES header — file was not produced by toTXT",
        "INVALID_INPUT",
      );
    }

    const declaredVersion = parseInt(magic.replace("MAJIKBYTES:v", ""), 10);
    if (isNaN(declaredVersion)) {
      throw new MajikBytesError(
        "fromTXT: invalid version in header",
        "INVALID_INPUT",
      );
    }

    // Decode payload
    const b64Line = lines[1]!.trim();
    const hashLine = lines[2]!.trim();

    let prefixed: Uint8Array;
    try {
      prefixed = base64ToUint8(b64Line);
    } catch {
      throw new MajikBytesError(
        "fromTXT: invalid base-64 data",
        "CORRUPT_DATA",
      );
    }

    // Verify hash
    const digest = sha3_512(prefixed);
    const digestHex = uint8ToHex(digest);

    if (!MajikBytes._constantTimeEqualStrings(digestHex, hashLine)) {
      throw new MajikBytesError(
        "fromTXT: SHA-3-512 hash mismatch — payload is corrupt or tampered",
        "INVALID_INPUT",
      );
    }

    const { sourceType, version, fileMeta } = decodePrefix(prefixed);
    return new MajikBytes(prefixed, sourceType, version, fileMeta);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────────────────

  static async isValidPNG(
    blob: Blob | File,
  ): Promise<MajikBytesValidationResult> {
    if (blob.type !== "image/png") {
      return {
        isValid: false,
        message: "Invalid MIME type. Expected 'image/png'.",
      };
    }
    try {
      const { rgba, width, height } = await MajikBytes._decodePNGToRGBA(blob);
      if (height < 3) {
        return {
          isValid: false,
          message: "PNG is too short to contain data, sentinel, and hash rows.",
        };
      }
      return MajikBytes._verifyPNGFooterAndHash(rgba, width, height);
    } catch (err) {
      return {
        isValid: false,
        message: `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  static async isValidTXT(
    blob: Blob | File,
  ): Promise<MajikBytesValidationResult> {
    try {
      await MajikBytes.fromTXT(blob);
      return { isValid: true, message: "Valid MajikBytes TXT." };
    } catch (err) {
      return {
        isValid: false,
        message: `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dimension helper
  // ─────────────────────────────────────────────────────────────────────────

  static _computeDimensions(byteCount: number): PNGDimensions {
    if (byteCount <= 0) {
      throw new MajikBytesError(
        "Cannot compute dimensions for empty byte array",
        "INVALID_INPUT",
      );
    }
    const requiredPixels = Math.ceil(byteCount / 3);

    // Calculate a square-ish width, but force it to be at least 22 pixels
    // so the 64-byte SHA-3-512 hash can safely fit in the final hash row.
    let width = Math.ceil(Math.sqrt(requiredPixels));
    if (width < 22) {
      width = 22;
    }

    const dataRows = Math.ceil(requiredPixels / width);
    const dataPixels = width * dataRows;

    return { width, height: dataRows, dataPixels, dataRows };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private – PNG validation helper
  // ─────────────────────────────────────────────────────────────────────────

  private static _verifyPNGFooterAndHash(
    rgba: Uint8Array,
    width: number,
    height: number,
  ): MajikBytesValidationResult {
    const rowBytes = width * 4;
    let sentinelRow = -1;
    let originalLength = 0;

    for (let y = height - 2; y >= 0; y--) {
      const rowStart = y * rowBytes;
      const possibleLength =
        (rgba[rowStart] << 16) | (rgba[rowStart + 1] << 8) | rgba[rowStart + 2];

      if (possibleLength === 0) continue;

      let isSentinel = true;
      for (let i = 4; i < rowBytes; i += 4) {
        if (
          rgba[rowStart + i] !== 0 ||
          rgba[rowStart + i + 1] !== 0 ||
          rgba[rowStart + i + 2] !== 0
        ) {
          isSentinel = false;
          break;
        }
      }

      if (isSentinel) {
        sentinelRow = y;
        originalLength = possibleLength;
        break;
      }
    }

    if (sentinelRow === -1) {
      return {
        isValid: false,
        message:
          "Sentinel row not found. Image was not produced by MajikBytes.",
      };
    }

    const hashRowIndex = sentinelRow + 1;
    if (hashRowIndex >= height)
      return { isValid: false, message: "Hash row is missing." };

    const hashRowStart = hashRowIndex * rowBytes;
    if (hashRowStart + rowBytes > rgba.byteLength)
      return { isValid: false, message: "Hash row is truncated." };

    const hashRowPixels = new Uint8Array(
      rgba.buffer,
      rgba.byteOffset + hashRowStart,
      rowBytes,
    );
    const storedHash = readRGB(hashRowPixels, 0, HASH_BYTE_LENGTH);
    const payloadBytes = readRGB(rgba, 0, originalLength);
    const digest = sha3_512(payloadBytes);

    if (!MajikBytes._constantTimeEqual(digest, storedHash)) {
      return {
        isValid: false,
        message: "SHA-3-512 hash mismatch. Payload may be corrupt or tampered.",
      };
    }
    return { isValid: true, message: "Valid MajikBytes PNG." };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private – PNG RGBA decoder
  // ─────────────────────────────────────────────────────────────────────────

  private static async _decodePNGToRGBA(
    blob: Blob,
  ): Promise<{ rgba: Uint8Array; width: number; height: number }> {
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
      colorSpace: "srgb",
    });

    if (!ctx) {
      throw new MajikBytesError(
        "_decodePNGToRGBA: could not acquire 2D context from OffscreenCanvas",
        "INVALID_INPUT",
      );
    }

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, width, height);
    return {
      rgba: toConcreteUint8Array(new Uint8Array(imageData.data.buffer)),
      width,
      height,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private – TXT helper
  // ─────────────────────────────────────────────────────────────────────────

  private static async _readBlobAsText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(
          new MajikBytesError("fromTXT: failed to read blob", "INVALID_INPUT"),
        );
      reader.readAsText(blob);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private – comparison helpers
  // ─────────────────────────────────────────────────────────────────────────

  private static _constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  /** Constant-time string comparison for hex digests. */
  private static _constantTimeEqualStrings(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private – type assertion
  // ─────────────────────────────────────────────────────────────────────────

  private _assertType(expected: MajikBytesSourceType, method: string): void {
    if (this.sourceType !== expected) {
      throw new MajikBytesError(
        `${method}: source type is "${this.sourceType}", expected "${expected}"`,
        "TYPE_MISMATCH",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private – input normalisation
  // ─────────────────────────────────────────────────────────────────────────

  private static async _normalise(input: unknown): Promise<PrefixedPayload> {
    const enc = new TextEncoder();

    // Uint8Array
    if (input instanceof Uint8Array) {
      return {
        prefixed: encodePrefix(toConcreteUint8Array(input), "uint8array"),
        sourceType: "uint8array",
      };
    }
    // ArrayBuffer
    if (input instanceof ArrayBuffer) {
      return {
        prefixed: encodePrefix(
          toConcreteUint8Array(new Uint8Array(input)),
          "arraybuffer",
        ),
        sourceType: "arraybuffer",
      };
    }
    // Other ArrayBufferViews
    if (ArrayBuffer.isView(input)) {
      const v = input as ArrayBufferView;
      const raw = toConcreteUint8Array(
        new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength),
      );
      return {
        prefixed: encodePrefix(raw, "arraybuffer"),
        sourceType: "arraybuffer",
      };
    }
    // File (must come before Blob — File extends Blob)
    if (typeof File !== "undefined" && input instanceof File) {
      const ab = await input.arrayBuffer();
      const raw = toConcreteUint8Array(new Uint8Array(ab));
      const meta: FileMeta = {
        filename: input.name || "blob",
        mimetype: input.type || "application/octet-stream",
      };
      return {
        prefixed: encodePrefix(raw, "file", meta),
        sourceType: "file",
        fileMeta: meta,
      };
    }
    // Blob
    if (input instanceof Blob) {
      const ab = await input.arrayBuffer();
      const raw = toConcreteUint8Array(new Uint8Array(ab));
      const meta: FileMeta = {
        filename: "blob",
        mimetype: input.type || "application/octet-stream",
      };
      return {
        prefixed: encodePrefix(raw, "blob", meta),
        sourceType: "blob",
        fileMeta: meta,
      };
    }
    // String
    if (typeof input === "string") {
      return {
        prefixed: encodePrefix(
          toConcreteUint8Array(enc.encode(input)),
          "string",
        ),
        sourceType: "string",
      };
    }
    // Number
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new MajikBytesError(
          "Input number must be finite",
          "INVALID_INPUT",
        );
      }
      return {
        prefixed: encodePrefix(
          toConcreteUint8Array(enc.encode(String(input))),
          "number",
        ),
        sourceType: "number",
      };
    }
    // BigInt
    if (typeof input === "bigint") {
      return {
        prefixed: encodePrefix(
          toConcreteUint8Array(enc.encode(String(input))),
          "bigint",
        ),
        sourceType: "bigint",
      };
    }
    // Boolean
    if (typeof input === "boolean") {
      return {
        prefixed: encodePrefix(
          toConcreteUint8Array(enc.encode(String(input))),
          "boolean",
        ),
        sourceType: "boolean",
      };
    }
    // JSON object / array
    if (typeof input === "object" && input !== null) {
      let serialised: string;
      try {
        serialised = JSON.stringify(input);
      } catch (err) {
        throw new MajikBytesError(
          `Input object is not JSON-serialisable: ${(err as Error).message}`,
          "INVALID_INPUT",
        );
      }
      return {
        prefixed: encodePrefix(
          toConcreteUint8Array(enc.encode(serialised)),
          "json",
        ),
        sourceType: "json",
      };
    }

    throw new MajikBytesError(
      `Unsupported input type: ${typeof input}`,
      "INVALID_INPUT",
    );
  }
}

// Keep reference to HASH_BYTE_LENGTH used in decoder
void HASH_BYTE_LENGTH;
