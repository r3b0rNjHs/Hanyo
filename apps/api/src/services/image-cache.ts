import fs from "node:fs";
import path from "node:path";

/**
 * Size-capped disk cache for page and cover images.
 * Eviction is least-recently-used by file mtime (we touch on read).
 */
export class ImageCache {
  private totalBytes = 0;
  private evicting = false;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.totalBytes = this.scan().reduce((sum, f) => sum + f.size, 0);
  }

  get size(): number {
    return this.totalBytes;
  }

  get limit(): number {
    return this.maxBytes;
  }

  read(key: string): { bytes: Buffer; contentType: string } | null {
    const file = this.file(key);
    try {
      const bytes = fs.readFileSync(file);
      const now = new Date();
      fs.utimesSync(file, now, now);
      return { bytes, contentType: sniffContentType(bytes) };
    } catch {
      return null;
    }
  }

  has(key: string): boolean {
    return fs.existsSync(this.file(key));
  }

  write(key: string, bytes: Buffer): void {
    const file = this.file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
    this.totalBytes += bytes.length;
    if (this.totalBytes > this.maxBytes) this.evict();
  }

  remove(key: string): void {
    const file = this.file(key);
    try {
      const { size } = fs.statSync(file);
      fs.rmSync(file);
      this.totalBytes -= size;
    } catch {
      // Already gone.
    }
  }

  private evict(): void {
    if (this.evicting) return;
    this.evicting = true;
    try {
      const files = this.scan().sort((a, b) => a.mtimeMs - b.mtimeMs);
      this.totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      const target = this.maxBytes * 0.9;
      for (const f of files) {
        if (this.totalBytes <= target) break;
        fs.rmSync(f.path, { force: true });
        this.totalBytes -= f.size;
      }
    } finally {
      this.evicting = false;
    }
  }

  private scan(): Array<{ path: string; size: number; mtimeMs: number }> {
    const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) {
          const st = fs.statSync(p);
          out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
        }
      }
    };
    walk(this.dir);
    return out;
  }

  private file(key: string): string {
    // Keys are generated internally ("pages/12/3", "covers/<sha1>"); still refuse traversal.
    if (key.includes("..")) throw new Error("Invalid cache key");
    return path.join(this.dir, key);
  }
}

export function sniffContentType(b: Buffer): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  if (b.length >= 6 && b.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp") return "image/avif";
  return "application/octet-stream";
}
