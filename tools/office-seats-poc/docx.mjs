import { crc32, inflateRawSync } from 'node:zlib';

// The isolated fixture supports ordinary DOCX ZIPs only, not encrypted or ZIP64 archives.
export function validateDocx(bytes) {
  const limit = 50 * 1024 * 1024;
  if (bytes.length < 22 || bytes.length > limit) throw Error('Invalid DOCX size');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw Error('Invalid ZIP directory');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  let position = bytes.readUInt32LE(end + 16);
  if (!count || count === 0xffff || bytes.readUInt16LE(end + 8) !== count || position + centralSize !== end) throw Error('Invalid ZIP directory');
  const names = new Set();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) throw Error('Invalid ZIP entry');
    const flags = bytes.readUInt16LE(position + 8);
    const method = bytes.readUInt16LE(position + 10);
    const checksum = bytes.readUInt32LE(position + 16);
    const compressed = bytes.readUInt32LE(position + 20);
    const size = bytes.readUInt32LE(position + 24);
    const nameSize = bytes.readUInt16LE(position + 28);
    const extraSize = bytes.readUInt16LE(position + 30);
    const commentSize = bytes.readUInt16LE(position + 32);
    const local = bytes.readUInt32LE(position + 42);
    const next = position + 46 + nameSize + extraSize + commentSize;
    if ((flags & 1) || ![0, 8].includes(method) || next > end || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('Unsupported ZIP entry');
    const name = bytes.subarray(position + 46, position + 46 + nameSize).toString('utf8');
    const localNameSize = bytes.readUInt16LE(local + 26);
    const start = local + 30 + localNameSize + bytes.readUInt16LE(local + 28);
    if (names.has(name) || name !== bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8') || start + compressed > bytes.readUInt32LE(end + 16)) throw Error('Invalid ZIP entry');
    names.add(name);
    total += size;
    if (size > limit || total > limit) throw Error('DOCX contents too large');
    const encoded = bytes.subarray(start, start + compressed);
    const content = method === 0 ? encoded : inflateRawSync(encoded, {maxOutputLength: limit});
    if (content.length !== size || crc32(content) !== checksum) throw Error('DOCX integrity check failed');
    position = next;
  }
  if (position !== end || !['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].every(name => names.has(name))) throw Error('Incomplete DOCX');
}
