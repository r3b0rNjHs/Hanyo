import type { SourceInfo } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openMemoryDb } from "../src/db/index.js";
import { Signer } from "../src/lib/signing.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider, RawSeries } from "../src/providers/types.js";
import { LibraryService } from "../src/services/library.js";
import { UserError, UserService } from "../src/services/users.js";

function users() {
  const db = openMemoryDb();
  const svc = new UserService(db);
  svc.bootstrap("first-password");
  return { db, svc };
}

describe("UserService", () => {
  it("turns the existing data's owner into an admin with the old password", () => {
    const { svc } = users();
    expect(svc.authenticate("admin", "first-password")).toMatchObject({ id: 1, isAdmin: true });
    // Older app versions log in with the password only.
    expect(svc.authenticate(null, "first-password")?.id).toBe(1);
    expect(svc.authenticate("admin", "wrong")).toBeNull();
    // Bootstrap only fills an empty password.
    svc.bootstrap("other");
    expect(svc.authenticate("admin", "other")).toBeNull();
  });

  it("creates accounts with unique, case-insensitive usernames", () => {
    const { svc } = users();
    svc.create("Marta", "marta-password");
    expect(svc.authenticate("marta", "marta-password")?.username).toBe("Marta");
    expect(() => svc.create("MARTA", "another-pass")).toThrow(UserError);
    expect(() => svc.create("x", "long-enough")).toThrow(/usuario/);
    expect(() => svc.create("pablo", "short")).toThrow(/8 caracteres/);
  });

  it("changing the password needs the current one and ends other sessions", () => {
    const { svc } = users();
    const before = svc.get(1)!.sessionVersion;
    expect(() => svc.updateAccount(1, "nope", { password: "new-password" })).toThrow(/actual/);
    const after = svc.updateAccount(1, "first-password", { username: "owner", password: "new-password" });
    expect(after.username).toBe("owner");
    expect(after.sessionVersion).toBe(before + 1);
    expect(svc.authenticate("owner", "new-password")?.id).toBe(1);
  });

  it("never deletes the last admin", () => {
    const { svc } = users();
    const marta = svc.create("marta", "marta-password");
    expect(() => svc.remove(1)).toThrow(/único administrador/);
    svc.remove(marta.id);
    expect(svc.get(marta.id)).toBeNull();
  });

  it("invites are single use", () => {
    const { svc } = users();
    const { token } = svc.createInvite(1);
    expect(svc.inviteValid(token)).toBe(true);
    const u = svc.redeemInvite(token, "pablo", "pablo-password");
    expect(u.isAdmin).toBe(false);
    expect(svc.inviteValid(token)).toBe(false);
    expect(() => svc.redeemInvite(token, "otro", "otro-password")).toThrow(/ya no es válida/);
  });
});

class OneSeries implements Provider {
  readonly id = "mangadex" as const;
  async listSources(): Promise<SourceInfo[]> {
    return [{ key: "mangadex", provider: "mangadex", sourceId: "mangadex", name: "MangaDex", lang: "en", iconUrl: null }];
  }
  async search() {
    return [];
  }
  async browse() {
    return { hits: [], hasNextPage: false };
  }
  async getSeries(): Promise<RawSeries> {
    return {
      externalId: "s",
      title: "Shared",
      coverUrl: null,
      description: null,
      authors: [],
      genres: [],
      status: "ongoing",
      url: null,
      chapters: [1, 2, 3].map((n) => ({ externalId: `c${n}`, number: n, title: null, scanlator: null, publishedAt: n, sourceOrder: n })),
    };
  }
  async getPageUrls() {
    return [];
  }
  async fetchImage() {
    return { bytes: Buffer.alloc(0), contentType: "image/png" };
  }
  allowsImageUrl() {
    return true;
  }
}

describe("per-user data", () => {
  it("keeps libraries, lists and progress apart while sharing the catalogue", async () => {
    const { db, svc } = users();
    const marta = svc.create("marta", "marta-password");
    const library = new LibraryService(db, new ProviderRegistry([new OneSeries()]), (_k, u) => u);
    const id = await library.open("mangadex", "s");

    library.setShelf(1, id, "paused");
    library.markRead(1, id, [1, 2], true);
    expect(library.listLibrary(1).map((s) => [s.shelf, s.unreadCount])).toEqual([["paused", 1]]);

    expect(library.listLibrary(marta.id)).toEqual([]);
    const seen = library.detailFromDb(id, marta.id)!;
    expect(seen.inLibrary).toBe(false);
    expect(seen.chapters.every((c) => !c.read)).toBe(true);
    // Same series row and chapters for everyone.
    expect(seen.chapters.map((c) => c.id)).toEqual(library.detailFromDb(id, 1)!.chapters.map((c) => c.id));

    library.setShelf(marta.id, id, "reading");
    expect(library.inLibraryIds().sort()).toEqual([id]);
    expect(library.usersToNotify(id).sort()).toEqual([1, marta.id]);
    svc.remove(marta.id);
    expect(library.usersToNotify(id)).toEqual([1]);
  });
});

describe("auth routes", () => {
  function app() {
    const { db, svc } = users();
    const signer = new Signer("test-secret");
    const library = new LibraryService(db, new ProviderRegistry([new OneSeries()]), (_k, u) => u);
    const api = createApp({
      users: svc,
      signer,
      secureCookies: false,
      library,
      // Not used by these routes.
      registry: {} as never,
      pages: {} as never,
      updates: {} as never,
      push: {} as never,
      titles: {} as never,
      log: () => {},
    });
    const call = (path: string, init: RequestInit = {}, cookie?: string) =>
      api.request(`/api${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
      });
    return { svc, signer, call };
  }
  const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

  it("logs in by username and identifies the user", async () => {
    const { call } = app();
    const res = await call("/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "first-password" }) });
    expect(res.status).toBe(200);
    const me = await (await call("/auth/me", {}, cookieOf(res))).json();
    expect(me.user).toEqual({ id: 1, username: "admin", isAdmin: true });
  });

  it("accepts sessions from before accounts as the admin", async () => {
    const { call, signer } = app();
    const old = `hanyo_session=${signer.sign({ v: 1, iat: 1 })}`;
    expect((await (await call("/auth/me", {}, old)).json()).user.id).toBe(1);
  });

  it("a password change logs out other sessions", async () => {
    const { call } = app();
    const login = await call("/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "first-password" }) });
    const other = cookieOf(login);
    const change = await call(
      "/auth/account",
      { method: "POST", body: JSON.stringify({ currentPassword: "first-password", password: "brand-new-pass" }) },
      other,
    );
    expect(change.status).toBe(200);
    expect((await call("/auth/me", {}, other)).status).toBe(401);
    expect((await call("/auth/me", {}, cookieOf(change))).status).toBe(200);
  });
});
