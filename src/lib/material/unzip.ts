/**
 * Just enough of a zip reader for .pptx decks (Node's own zlib, no dependency): the central
 * directory lists the entries, and an entry is inflated only when it's asked for, never past
 * `maxEntryBytes` (a zip bomb stops there) or `maxTotalBytes` over the whole file. Encrypted and
 * ZIP64 archives are refused. Loads under plain Node.
 */
import { inflateRawSync } from "node:zlib";

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

interface Entry {
  method: number;
  flags: number;
  compressed: number;
  size: number;
  local: number;
}

export interface Zip {
  names: string[];
  has: (name: string) => boolean;
  /** An entry's text (UTF-8), or null when the archive has no such entry. */
  text: (name: string) => string | null;
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function openZip(bytes: Uint8Array, { maxEntryBytes = 8 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024, maxEntries = 10_000 } = {}): Zip {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  // The end-of-central-directory record: the last 22 bytes, plus a comment of up to 64 KB.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("it isn't a complete zip archive");
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new ZipError("ZIP64 archives aren't supported");
  if (count > maxEntries) throw new ZipError(`it has ${count} entries`);

  const latin1 = new TextDecoder("latin1");
  const utf8 = new TextDecoder("utf-8");
  const entries = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== 0x02014b50) throw new ZipError("its directory is damaged");
    const flags = u16(at + 8);
    const nameLength = u16(at + 28);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = (flags & 0x800 ? utf8 : latin1).decode(nameBytes);
    entries.set(name, { method: u16(at + 10), flags, compressed: u32(at + 20), size: u32(at + 24), local: u32(at + 42) });
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }

  let inflated = 0;
  const text = (name: string): string | null => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 0x1) throw new ZipError("it's password-protected");
    if (e.local + 30 > bytes.length || u32(e.local) !== 0x04034b50) throw new ZipError(`${name} is damaged`);
    const start = e.local + 30 + u16(e.local + 26) + u16(e.local + 28);
    const data = bytes.subarray(start, start + e.compressed);
    if (data.length < e.compressed) throw new ZipError(`${name} is cut short`);
    let out: Uint8Array;
    if (e.method === 0) out = data;
    else if (e.method === 8) {
      try {
        out = inflateRawSync(data, { maxOutputLength: maxEntryBytes });
      } catch {
        throw new ZipError(`${name} is damaged or too large`);
      }
    } else throw new ZipError(`${name} uses an unsupported compression`);
    if (out.length > maxEntryBytes) throw new ZipError(`${name} is too large`);
    inflated += out.length;
    if (inflated > maxTotalBytes) throw new ZipError("it unpacks to too much data");
    return utf8.decode(out);
  };

  return { names: [...entries.keys()], has: (name) => entries.has(name), text };
}
