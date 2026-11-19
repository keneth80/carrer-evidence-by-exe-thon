import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

// 원본·추출 텍스트 파일 저장소. 경로는 서버가 만든 ID로만 조합하고 사용자 파일명은 쓰지 않는다.
const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]{1,160}$/;

export type ObjectStore = {
  put(workspaceId: string, key: string, bytes: Uint8Array): void;
  read(workspaceId: string, key: string): Buffer;
  remove(workspaceId: string, key: string): void;
};

export function createObjectStore(rootDir: string): ObjectStore {
  const root = resolve(rootDir);
  const pathOf = (workspaceId: string, key: string) => {
    const segments = [workspaceId, ...key.split('/')];
    if (!segments.every(segment => SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..')) throw new Error('OBJECT_KEY_INVALID');
    const path = join(root, ...segments);
    if (!path.startsWith(root + sep)) throw new Error('OBJECT_KEY_INVALID');
    return path;
  };
  return {
    put(workspaceId, key, bytes) {
      const path = pathOf(workspaceId, key);
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${randomUUID()}.tmp`;
      // DB commit 전에 파일 내용과 이름 변경을 디스크에 반영한다.
      const fd = openSync(temp, 'wx');
      try {
        for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      renameSync(temp, path);
      const dir = openSync(dirname(path), 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
    },
    read(workspaceId, key) {
      return readFileSync(pathOf(workspaceId, key));
    },
    remove(workspaceId, key) {
      rmSync(pathOf(workspaceId, key), { force: true });
    },
  };
}
