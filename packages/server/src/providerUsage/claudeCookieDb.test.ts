import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { decryptChromiumCookieValue, deriveChromiumCookieKey } from "./claudeCookieCrypto.ts"
import {
	CLAUDE_DESKTOP_COOKIE_ACCOUNT,
	CLAUDE_DESKTOP_COOKIE_SERVICE,
	claudeDesktopCookiesPath,
	readClaudeSessionCookies,
} from "./claudeCookieDb.ts"
import type { SecurityKeychainShape } from "./Services/SecurityKeychain.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

// Test-only password -- never a real Keychain secret.
const TEST_PASSWORD = "test-only-cookie-db-password"

const encryptCookieValue = Effect.fn("test.encryptCookieValue")(function*(key: Uint8Array, plaintext: string) {
	const iv = new Uint8Array(16).fill(0x20)
	const cryptoKey = yield* Effect.promise(() =>
		crypto.subtle.importKey("raw", new Uint8Array(key), { name: "AES-CBC" }, false, ["encrypt"])
	)
	const encoded = new TextEncoder().encode(`${"x".repeat(32)}${plaintext}`)
	const ciphertextBuffer = yield* Effect.promise(() => crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, encoded))
	const ciphertext = new Uint8Array(ciphertextBuffer)
	const prefix = new TextEncoder().encode("v10")
	const out = new Uint8Array(prefix.length + ciphertext.length)
	out.set(prefix, 0)
	out.set(ciphertext, prefix.length)
	return out
})

// Builds a throwaway sqlite DB shaped like Chromium's real Cookies DB (just
// the `cookies` table and the columns readClaudeSessionCookies queries),
// with one row per cookie encrypted with the given key -- the same v10
// AES-128-CBC format the Live code decrypts.
const writeFixtureCookieDb = Effect.fn("test.writeFixtureCookieDb")(function*(
	dbPath: string,
	key: Uint8Array,
	cookies: ReadonlyArray<{ readonly name: string; readonly value: string }>,
) {
	yield* Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		// The client defaults to WAL mode, which leaves committed rows in a
		// side "-wal" file until a checkpoint. readClaudeSessionCookies (like
		// the real Rust code) copies only the single main db file, so force
		// everything to land there directly -- otherwise the copy in this test
		// would see an empty/missing table, not a WAL-mode quirk of the real
		// Claude desktop app's Cookies file.
		yield* sql`PRAGMA journal_mode = DELETE`.withoutTransform
		yield* sql`CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB)`.withoutTransform
		for (const cookie of cookies) {
			const encrypted = yield* encryptCookieValue(key, cookie.value)
			yield* sql`INSERT INTO cookies (host_key, name, encrypted_value) VALUES (${"https://claude.ai"}, ${cookie.name}, ${encrypted})`
				.withoutTransform
		}
	}).pipe(
		// Single-use, torn-down-before-return sqlite connection for building a
		// test fixture -- see claudeCookieDb.ts's own disable comment for the
		// same shape of scoped, self-contained resource use.
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(SqliteClient.layer({ filename: dbPath, create: true, readwrite: true })),
	)
})

const fakeKeychain = (password: string | null): SecurityKeychainShape => ({
	findGenericPassword: () => Effect.succeed(password === null ? Option.none() : Option.some(password)),
})

Vitest.layer(PlatformLive)("readClaudeSessionCookies", (it) => {
	it.effect("copies the cookie DB, decrypts the wanted cookies, and requires sessionKey", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const cookiesPath = claudeDesktopCookiesPath(homeDir, path)
			yield* fs.makeDirectory(path.dirname(cookiesPath), { recursive: true })

			const key = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			yield* writeFixtureCookieDb(cookiesPath, key, [
				{ name: "sessionKey", value: "sess-abc123" },
				{ name: "lastActiveOrg", value: "org-xyz" },
				{ name: "not-a-wanted-cookie", value: "ignored" },
			])

			const keychain = fakeKeychain(TEST_PASSWORD)
			const cookies = yield* readClaudeSessionCookies(fs, path, keychain, homeDir)

			Vitest.assert.strictEqual(cookies.get("sessionKey"), "sess-abc123")
			Vitest.assert.strictEqual(cookies.get("lastActiveOrg"), "org-xyz")
			Vitest.assert.isFalse(cookies.has("not-a-wanted-cookie"))
		})
	)

	it.effect("fails when the cookies file does not exist", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const exit = yield* Effect.exit(readClaudeSessionCookies(fs, path, fakeKeychain(TEST_PASSWORD), homeDir))
			Vitest.assert.strictEqual(exit._tag, "Failure")
		})
	)

	it.effect("fails when the Keychain has no cookie key", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const cookiesPath = claudeDesktopCookiesPath(homeDir, path)
			yield* fs.makeDirectory(path.dirname(cookiesPath), { recursive: true })
			yield* fs.writeFileString(cookiesPath, "not a real sqlite file")

			const exit = yield* Effect.exit(readClaudeSessionCookies(fs, path, fakeKeychain(null), homeDir))
			Vitest.assert.strictEqual(exit._tag, "Failure")
		})
	)

	it.effect("fails when the sessionKey cookie is missing", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const cookiesPath = claudeDesktopCookiesPath(homeDir, path)
			yield* fs.makeDirectory(path.dirname(cookiesPath), { recursive: true })

			const key = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			yield* writeFixtureCookieDb(cookiesPath, key, [{ name: "lastActiveOrg", value: "org-xyz" }])

			const exit = yield* Effect.exit(
				readClaudeSessionCookies(fs, path, fakeKeychain(TEST_PASSWORD), homeDir),
			)
			Vitest.assert.strictEqual(exit._tag, "Failure")
		})
	)

	it.effect("asks the Keychain for the right service and account", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const cookiesPath = claudeDesktopCookiesPath(homeDir, path)
			yield* fs.makeDirectory(path.dirname(cookiesPath), { recursive: true })
			const key = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			yield* writeFixtureCookieDb(cookiesPath, key, [{ name: "sessionKey", value: "sess-1" }])

			let seenService: string | null = null
			let seenAccount: string | undefined
			const spyingKeychain: SecurityKeychainShape = {
				findGenericPassword: (input) => {
					seenService = input.service
					seenAccount = input.account
					return Effect.succeed(Option.some(TEST_PASSWORD))
				},
			}

			yield* readClaudeSessionCookies(fs, path, spyingKeychain, homeDir)
			Vitest.assert.strictEqual(seenService, CLAUDE_DESKTOP_COOKIE_SERVICE)
			Vitest.assert.strictEqual(seenAccount, CLAUDE_DESKTOP_COOKIE_ACCOUNT)
		})
	)
})
