import crypto from "node:crypto";

/** HMAC-signed opaque tokens, used for session cookies and image proxy URLs. */
export class Signer {
  constructor(private readonly secret: string) {}

  sign(payload: unknown): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  verify<T>(token: string): T | null {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = this.mac(body);
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return null;
    }
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return crypto.createHmac("sha256", this.secret).update(body).digest("base64url").slice(0, 32);
  }
}
