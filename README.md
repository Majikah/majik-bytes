
# MajikBytes

[![Developed by Zelijah](https://img.shields.io/badge/Developed%20by-Zelijah-red?logo=github&logoColor=white)](https://thezelijah.world) ![GitHub Sponsors](https://img.shields.io/github/sponsors/jedlsf?style=plastic&label=Sponsors&link=https%3A%2F%2Fgithub.com%2Fsponsors%2Fjedlsf)

**MajikBytes** is a TypeScript utility for lossless byte ↔ media conversion. It allows you to safely and losslessly encode arbitrary data (Files, JSON, Strings, ArrayBuffers) directly into standard PNG images or structured TXT files. 

Every `MajikBytes` payload includes embedded metadata to remember its original data type, a sentinel row for exact byte-length recovery, and a **SHA-3-512 hash** to mathematically guarantee that the extracted data has not been tampered with or corrupted by browser rendering engines.

![npm](https://img.shields.io/npm/v/@majikah/majik-bytes) ![npm downloads](https://img.shields.io/npm/dm/@majikah/majik-bytes) [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)

---

- [MajikBytes](#majikbytes)
  - [Architecture \& Encoding Scheme](#architecture--encoding-scheme)
    - [1. RGB Data Packing (Canvas-Safe)](#1-rgb-data-packing-canvas-safe)
    - [2. The Sentinel Row](#2-the-sentinel-row)
    - [3. SHA-3-512 Integrity Hash](#3-sha-3-512-integrity-hash)
    - [4. Type \& Meta Prefixing](#4-type--meta-prefixing)
  - [Overview](#overview)
    - [What is MajikBytes?](#what-is-majikbytes)
    - [Use Cases](#use-cases)
  - [Features](#features)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [API Reference](#api-reference)
    - [Factory Methods](#factory-methods)
      - [`MajikBytes.create(input: unknown)`](#majikbytescreateinput-unknown)
      - [`MajikBytes.fromJSON(json: unknown)`](#majikbytesfromjsonjson-unknown)
    - [Media Conversion (PNG \& TXT)](#media-conversion-png--txt)
      - [`majikBytes.toPNG()`](#majikbytestopng)
      - [`MajikBytes.fromPNG(blob: Blob)`](#majikbytesfrompngblob-blob)
      - [`majikBytes.toTXT()`](#majikbytestotxt)
      - [`MajikBytes.fromTXT(blob: Blob)`](#majikbytesfromtxtblob-blob)
    - [Type Restoration](#type-restoration)
    - [Validation](#validation)
      - [`MajikBytes.isValidPNG(blob: Blob | File)`](#majikbytesisvalidpngblob-blob--file)
      - [`MajikBytes.isValidTXT(blob: Blob | File)`](#majikbytesisvalidtxtblob-blob--file)
    - [Getters](#getters)
  - [Contributing](#contributing)
  - [License](#license)
  - [Author](#author)
  - [Contact](#contact)

---

## Architecture & Encoding Scheme

### 1. RGB Data Packing (Canvas-Safe)
Data is packed losslessly into the R, G, and B channels of a PNG (3 bytes per pixel). The Alpha channel is **strictly forced to 255** (fully opaque) on every pixel. This prevents browsers and the Canvas API from applying alpha premultiplication, which irreversibly corrupts data bytes carried in RGB channels.

### 2. The Sentinel Row
Because a PNG must be a perfect rectangle, the raw data rarely perfectly fills the final row. MajikBytes injects a dedicated "Sentinel Row" directly after the data payload. The first pixel of this row encodes the exact 24-bit original byte length. This ensures we never extract trailing zero-padded garbage bytes.

### 3. SHA-3-512 Integrity Hash
A 64-byte SHA-3-512 hash of the original prefixed payload is packed into the final row of the PNG. When `fromPNG` is called, the library extracts the data, re-hashes it, and compares it against the stored hash in constant time. Any single flipped bit will throw a `MajikBytesError`.

### 4. Type & Meta Prefixing
Before encoding, the payload is prefixed with metadata identifying its source type (e.g., `json`, `file`, `string`). For `file` and `blob` types, the original filename and MIME type are also preserved. This allows `majikBytes.restore()` to give you back exactly what you put in.

---

## Overview

### What is MajikBytes?

A `MajikBytes` instance is a portable, structured wrapper around raw data. It can serialize itself into multiple formats while remembering what it originally was. 

### Use Cases
- **Data Steganography:** Hide configuration files, JSON, or binary data inside a standard-looking PNG file.
- **Lossless Browser Storage:** Store complex binary structures in environments that only easily accept image uploads.
- **Tamper-Evident Payloads:** Distribute configuration files or data blobs that instantly fail to load if a single byte is altered in transit.

---

## Features

- **Multi-Format Support:** Convert virtually anything (`String`, `JSON`, `Uint8Array`, `ArrayBuffer`, `Blob`, `File`, `Number`, `BigInt`, `Boolean`) into a media payload.
- **Lossless PNG Encoding:** Canvas-safe RGB packing ensures zero byte drift.
- **SHA-3-512 Integrity:** Cryptographic hashing prevents silent corruption or tampering.
- **Automatic Type Restoration:** Call `.toFile()`, `.toJSON()`, or `.restore()` to instantly get back your original data structures.
- **Format Agnostic:** Serialize to PNG (Image), TXT (Base64 + Hash), or standard JSON.
- **Browser & Node.js Ready:** Uses standard Web APIs (`OffscreenCanvas`, `TextEncoder`, `Blob`).

---

## Installation

```bash
# Using npm
npm install @majikah/majik-bytes

```

---
## Quick Start

```ts

import { MajikBytes } from '@majikah/majik-bytes';

// ── Step 1: Create a MajikBytes instance from any data ───────────────────────
const originalData = { text: "Hi there!", id: 42 };
const mBytes = await MajikBytes.create(originalData);

// ── Step 2: Encode to a PNG Blob ─────────────────────────────────────────────
const pngBlob = await mBytes.toPNG();
// You can now download or upload this PNG file!

// ── Step 3: Decode back from the PNG ─────────────────────────────────────────
const loadedBytes = await MajikBytes.fromPNG(pngBlob);

// ── Step 4: Restore to original type ─────────────────────────────────────────
if (loadedBytes.isJSON()) {
  const data = loadedBytes.toJSONValue<{ text: string, id: number }>();
  console.log(data.text); // "This is a message"
}

```

---

## API Reference

### Factory Methods

#### `MajikBytes.create(input: unknown)`
Creates a new instance from almost any JavaScript data type. Automatically normalizes the input and applies the metadata prefix.
**Returns:** `Promise<MajikBytes>`

#### `MajikBytes.fromJSON(json: unknown)`
Restores an instance from a standard JSON object containing Base64 data and a length check.

---

### Media Conversion (PNG & TXT)

#### `majikBytes.toPNG()`
Encodes the payload, sentinel row, and SHA-3-512 hash into a lossless RGBA PNG.
**Returns:** `Promise<Blob>` (type: `image/png`)

#### `MajikBytes.fromPNG(blob: Blob)`
Decodes a PNG Blob. Extracts the exact payload length, verifies the SHA-3-512 hash, and reconstructs the data.
**Throws:** `MajikBytesError` if the hash mismatches or the PNG is malformed.

#### `majikBytes.toTXT()`
Encodes the payload as a portable text file containing a magic header, base-64 data, and the hex-encoded SHA-3-512 hash.
**Returns:** `Promise<Blob>` (type: `text/plain`)

#### `MajikBytes.fromTXT(blob: Blob)`
Decodes a TXT Blob produced by `toTXT`.

---

### Type Restoration

Once you have a `MajikBytes` instance, you can safely restore it to its original form.

| Method | Returns | Notes |
|---|---|---|
| `toString()` | `string` | UTF-8 decoded string |
| `toJSONValue<T>()` | `T` | Parses the payload as JSON |
| `toFile()` | `File` | Restores original filename and MIME type |
| `toBlob()` | `Blob` | Restores standard Blob |
| `toUint8Array()` | `Uint8Array` | Returns raw un-prefixed bytes |
| `restore()` | `Promise<unknown>` | Auto-restores based on `sourceType` |

*Note: Calling a specific type method (e.g. `toFile()`) on data that was originally a different type (e.g. `isString()`) will throw a `MajikBytesError("TYPE_MISMATCH")`.*

---

### Validation

Check if a file is a valid MajikBytes payload without fully decoding it into memory.

#### `MajikBytes.isValidPNG(blob: Blob | File)`
**Returns:** `Promise<{ isValid: boolean; message: string }>`

#### `MajikBytes.isValidTXT(blob: Blob | File)`
**Returns:** `Promise<{ isValid: boolean; message: string }>`

---

### Getters

| Getter | Type | Description |
|---|---|---|
| `sourceType` | `MajikBytesSourceType` | The original type (e.g., `'json'`, `'file'`) |
| `bytes` | `Uint8Array` | Defensive copy of the raw, un-prefixed bytes |
| `byteLength` | `number` | Size of the raw bytes |
| `fileMeta` | `FileMeta \| undefined` | Filename and MIME type (if applicable) |



---

## Contributing

If you want to contribute or help extend support, reach out via email. All contributions are welcome!

---

## License

[Apache-2.0](LICENSE) — free for personal and commercial use.

---

## Author

Made with 💙 by [@thezelijah](https://github.com/jedlsf)

**Developer**: Josef Elijah Fabian  
**GitHub**: [https://github.com/jedlsf](https://github.com/jedlsf)  
**Project Repository**: [https://github.com/Majikah/majik-bytes](https://github.com/Majikah/majik-bytes)

---

## Contact

- **Business Email**: [business@thezelijah.world](mailto:business@thezelijah.world)
- **Official Website**: [https://www.thezelijah.world](https://www.thezelijah.world)