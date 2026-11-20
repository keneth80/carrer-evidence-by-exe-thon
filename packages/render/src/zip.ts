// 압축하지 않는(저장 방식) zip 작성기. Word(.docx)는 zip이므로 새 패키지 없이 브라우저·node 모두에서 쓴다.
// 날짜는 1980-01-01로 고정해 같은 입력이면 같은 bytes가 된다. 파일 이름은 UTF-8(플래그 0x0800).

export type ZipEntry = { name: string; data: Uint8Array };

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_FLAG = 0x0800;

function header(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

export function storeZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const local = header(30, view => {
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, UTF8_FLAG, true); view.setUint16(8, 0, true);
      view.setUint16(10, 0, true); view.setUint16(12, DOS_DATE, true); view.setUint32(14, crc, true);
      view.setUint32(18, size, true); view.setUint32(22, size, true); view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
    });
    central.push(header(46, view => {
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, UTF8_FLAG, true);
      view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint16(14, DOS_DATE, true); view.setUint32(16, crc, true);
      view.setUint32(20, size, true); view.setUint32(24, size, true); view.setUint16(28, name.length, true);
      view.setUint16(30, 0, true); view.setUint16(32, 0, true); view.setUint16(34, 0, true); view.setUint16(36, 0, true);
      view.setUint32(38, 0, true); view.setUint32(42, offset, true);
    }), name);
    chunks.push(local, name, entry.data);
    offset += local.length + name.length + size;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(22, view => {
    view.setUint32(0, 0x06054b50, true); view.setUint16(4, 0, true); view.setUint16(6, 0, true);
    view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
    view.setUint32(12, centralSize, true); view.setUint32(16, offset, true); view.setUint16(20, 0, true);
  });
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of all) { out.set(chunk, at); at += chunk.length; }
  return out;
}
