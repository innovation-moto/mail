import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// 1ファイルあたりの上限。超えたら <name>.1 へ退避して新規ファイルに切り替える（世代は1つだけ保持）
const MAX_BYTES = 5 * 1024 * 1024;

// ファイルごとの現在サイズ（毎回 stat しないようにメモリで追跡）
const sizes = new Map<string, number>();

function rotate(logPath: string, size: number): void {
  const backup = `${logPath}.1`;
  try { fs.rmSync(backup, { force: true }); } catch {}
  // 上限を桁違いに超えている（ローテーション導入前の肥大ファイル）なら退避せず捨てる
  if (size > MAX_BYTES * 10) {
    fs.rmSync(logPath, { force: true });
  } else {
    fs.renameSync(logPath, backup);
  }
}

/** userData 配下の name に1行追記する。上限超過時はローテーションする。失敗は無視。 */
export function appendLog(name: string, line: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), name);
    let size = sizes.get(logPath);
    if (size === undefined) {
      try { size = fs.statSync(logPath).size; } catch { size = 0; }
    }
    if (size >= MAX_BYTES) {
      rotate(logPath, size);
      size = 0;
    }
    const text = line.endsWith('\n') ? line : `${line}\n`;
    fs.appendFileSync(logPath, text);
    sizes.set(logPath, size + Buffer.byteLength(text));
  } catch {}
}
