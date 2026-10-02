import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../env";

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid storage key");
}

class LocalStorage implements StorageDriver {
  private root() {
    return path.resolve(env().STORAGE_LOCAL_DIR);
  }
  private resolve(key: string) {
    assertKey(key);
    const full = path.resolve(this.root(), key);
    if (!full.startsWith(this.root() + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class S3Storage implements StorageDriver {
  private client: any;
  private async c() {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      const e = env();
      if (!e.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
      this.client = new S3Client({
        region: e.S3_REGION,
        endpoint: e.S3_ENDPOINT || undefined,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
        credentials: e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } : undefined,
      });
    }
    return this.client;
  }
  async put(key: string, data: Buffer, contentType: string) {
    assertKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.c()).send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: undefined }));
  }
  async get(key: string) {
    assertKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const out = await (await this.c()).send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (e: any) {
      if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  async delete(key: string) {
    assertKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.c()).send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  driver ??= env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
  return driver;
}
export function resetStorageDriver() {
  driver = null;
}
