// Minimal ZIP reader (stored + deflate) on top of DecompressionStream, so the
// site needs no library. Enough for "zip my extension folder" archives.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** @returns {Promise<Array<{ path: string, bytes: Uint8Array }>>} files only */
export async function readZip(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件。');
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const files = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) throw new Error('zip 目录损坏。');
    const flags = view.getUint16(pointer + 8, true);
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const externalAttributes = view.getUint32(pointer + 38, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const path = decoder.decode(data.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('不支持加密的 zip。');
    // Unix symlinks in zips carry mode 0o120000 in the high 16 bits.
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      files.push({ path, bytes: new Uint8Array(), symlink: true });
      continue;
    }
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error('zip 文件头损坏。');
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    const compressed = data.subarray(start, start + compressedSize);
    if (method === 0) files.push({ path, bytes: compressed.slice() });
    else if (method === 8) files.push({ path, bytes: await inflateRaw(compressed) });
    else throw new Error(`zip 里的 ${path} 用了不支持的压缩方式。`);
  }
  return files;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
