import crypto from "node:crypto";
import type { DB } from "../db/index.js";

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  /** Bumped on password change: older session cookies stop working. */
  sessionVersion: number;
  createdAt: number;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string | null;
  is_admin: number;
  session_version: number;
  created_at: number;
}

const USERNAME = /^[\p{L}\p{N}._-]{2,32}$/u;
const MIN_PASSWORD = 8;
const INVITE_TTL_MS = 7 * 24 * 3600_000;
const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

/** A problem the user can fix (shown as is). */
export class UserError extends Error {}

function hash(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return ["scrypt", salt.toString("hex"), key.toString("hex")].join("$");
}

function verify(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  isAdmin: r.is_admin === 1,
  sessionVersion: r.session_version,
  createdAt: r.created_at,
});

/** Accounts, passwords and invite links. */
export class UserService {
  constructor(private readonly db: DB) {}

  /**
   * First start after the multi-user migration: the admin (user 1) gets HANYO_PASSWORD as its
   * password, so logging in keeps working. Later changes are made from the app.
   */
  bootstrap(adminPassword: string, adminUsername?: string): void {
    const admin = this.db.prepare<[], UserRow>("SELECT * FROM users WHERE id = 1").get();
    if (!admin || admin.password_hash) return;
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = 1").run(hash(adminPassword));
    if (adminUsername && USERNAME.test(adminUsername)) {
      this.db.prepare("UPDATE users SET username = ? WHERE id = 1").run(adminUsername);
    }
  }

  get(id: number): User | null {
    const r = this.db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?").get(id);
    return r ? toUser(r) : null;
  }

  list(): User[] {
    return this.db.prepare<[], UserRow>("SELECT * FROM users ORDER BY id").all().map(toUser);
  }

  admins(): number[] {
    return this.db.prepare<[], { id: number }>("SELECT id FROM users WHERE is_admin = 1").all().map((r) => r.id);
  }

  /** Username + password. No username means the first admin (older app versions sent only a password). */
  authenticate(username: string | null, password: string): User | null {
    const r = username
      ? this.db.prepare<[string], UserRow>("SELECT * FROM users WHERE username = ?").get(username.trim())
      : this.db.prepare<[], UserRow>("SELECT * FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1").get();
    if (!r) {
      // Same work whether or not the user exists, so timing doesn't reveal usernames.
      verify(password, DUMMY_HASH);
      return null;
    }
    return verify(password, r.password_hash) ? toUser(r) : null;
  }

  create(username: string, password: string, isAdmin = false): User {
    this.checkUsername(username);
    this.checkPassword(password);
    try {
      const id = Number(
        this.db
          .prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)")
          .run(username.trim(), hash(password), isAdmin ? 1 : 0, Date.now()).lastInsertRowid,
      );
      return this.get(id)!;
    } catch (e) {
      if (/UNIQUE/i.test((e as Error).message)) throw new UserError("Ese nombre de usuario ya existe");
      throw e;
    }
  }

  /** Change username and/or password; the current password is always required. */
  updateAccount(id: number, current: string, changes: { username?: string; password?: string }): User {
    const r = this.db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?").get(id);
    if (!r || !verify(current, r.password_hash)) throw new UserError("La contraseña actual no es correcta");
    if (changes.username !== undefined && changes.username.trim() !== r.username) {
      this.checkUsername(changes.username);
      try {
        this.db.prepare("UPDATE users SET username = ? WHERE id = ?").run(changes.username.trim(), id);
      } catch (e) {
        if (/UNIQUE/i.test((e as Error).message)) throw new UserError("Ese nombre de usuario ya existe");
        throw e;
      }
    }
    if (changes.password) {
      this.checkPassword(changes.password);
      this.db
        .prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?")
        .run(hash(changes.password), id);
    }
    return this.get(id)!;
  }

  /** Delete an account and everything personal in it. The last admin can't be removed. */
  remove(id: number): void {
    const u = this.get(id);
    if (!u) return;
    if (u.isAdmin && this.admins().length <= 1) throw new UserError("No se puede borrar el único administrador");
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  // ── Invites ────────────────────────────────────────────────────────────

  createInvite(createdBy: number): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(18).toString("base64url");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO invites (token, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(token, createdBy, now, now + INVITE_TTL_MS);
    return { token, expiresAt: now + INVITE_TTL_MS };
  }

  listInvites(): { token: string; createdAt: number; expiresAt: number }[] {
    return this.db
      .prepare<[number], { token: string; created_at: number; expires_at: number }>(
        "SELECT token, created_at, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
      )
      .all(Date.now())
      .map((r) => ({ token: r.token, createdAt: r.created_at, expiresAt: r.expires_at }));
  }

  revokeInvite(token: string): void {
    this.db.prepare("DELETE FROM invites WHERE token = ? AND used_at IS NULL").run(token);
  }

  inviteValid(token: string): boolean {
    return Boolean(
      this.db
        .prepare<[string, number], { token: string }>(
          "SELECT token FROM invites WHERE token = ? AND used_at IS NULL AND expires_at > ?",
        )
        .get(token, Date.now()),
    );
  }

  /** Create the account an invite is for; single use. */
  redeemInvite(token: string, username: string, password: string): User {
    return this.db.transaction(() => {
      if (!this.inviteValid(token)) throw new UserError("Esta invitación ya no es válida");
      const user = this.create(username, password);
      this.db.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE token = ?").run(user.id, Date.now(), token);
      return user;
    })();
  }

  private checkUsername(username: string): void {
    if (!USERNAME.test(username.trim())) {
      throw new UserError("El usuario debe tener 2–32 letras, números, puntos, guiones o guiones bajos");
    }
  }

  private checkPassword(password: string): void {
    if (password.length < MIN_PASSWORD) throw new UserError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
}
