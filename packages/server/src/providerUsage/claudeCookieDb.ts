import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { decryptChromiumCookieValue, deriveChromiumCookieKey } from "./claudeCookieCrypto.ts"
import type { SecurityKeychainShape } from "./Services/SecurityKeychain.ts"

// Ported from read_claude_session_cookies/read_chromium_cookie_key in
// mod.rs: the Claude desktop app's Chromium cookie database, decrypted with
// a key held in the macOS "Claude Safe Storage" Keychain item.
//
// Reads a COPY of the cookie DB in a temp directory -- the real file may be
// locked by the running Claude desktop app -- via @effect/sql-sqlite-bun,
// scoped so the temp file and sqlite connection are both cleaned up before
// this function returns. No cookie value or key byte is ever logged; only
// the final decrypted map (which itself never crosses the RPC boundary,
// see Layers/ProviderUsageService.ts) is returned to the caller.

export const CLAUDE_DESKTOP_COOKIE_SERVICE = "Claude Safe Storage"
export const CLAUDE_DESKTOP_COOKIE_ACCOUNT = "Claude"

const WANTED_CLAUDE_COOKIE_NAMES: ReadonlySet<string> = new Set([
	"sessionKey",
	"cf_clearance",
	"anthropic-device-id",
	"lastActiveOrg",
	"__cf_bm",
])

export class ClaudeCookieDbError extends Schema.TaggedError<ClaudeCookieDbError>()("ClaudeCookieDbError", {
	reason: Schema.String,
}) {
	override get message(): string {
		return this.reason
	}
}

export const claudeDesktopCookiesPath = (homeDir: string, path: Path.Path): string =>
	path.join(homeDir, "Library", "Application Support", "Claude", "Cookies")

const CookieRow = Schema.Struct({
	name: Schema.String,
	encrypted_value: Schema.Uint8Array,
})

const readCookieRows = Effect.fn("providerUsage.readCookieRows")(function*(dbFilePath: string) {
	const rows = yield* Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		return yield* sql`
			SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ${"%claude.ai%"}
		`.withoutTransform
	}).pipe(
		// This is a self-contained, single-use sqlite connection over a temp
		// file copy (see copyCookieDbAndReadRows) -- opened, queried, and torn
		// down entirely within this one call, never shared or held past it. Not
		// an application service, so it does not belong in the ambient Layer
		// graph the rest of the server composes at bootstrap.
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(
			SqliteClient.layer({ filename: dbFilePath, readonly: true, create: false, readwrite: false }),
		),
	)
	const decodeRow = Schema.decodeUnknownEffect(CookieRow)
	return yield* Effect.forEach(rows, (row) => decodeRow(row), { concurrency: 1 }).pipe(
		Effect.catchTag("SchemaError", () => Effect.succeed([])),
	)
})

const copyCookieDbAndReadRows = Effect.fn("providerUsage.copyCookieDbAndReadRows")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	cookiesPath: string,
) {
	return yield* Effect.scoped(
		Effect.gen(function*() {
			const tmpDir = yield* fs.makeTempDirectoryScoped()
			const tmpFile = path.join(tmpDir, "claude-cookies-copy.sqlite")
			yield* fs.copyFile(cookiesPath, tmpFile)
			return yield* readCookieRows(tmpFile)
		}),
	)
})

export const readClaudeSessionCookies = Effect.fn("providerUsage.readClaudeSessionCookies")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	keychain: SecurityKeychainShape,
	homeDir: string,
) {
	const cookiesPath = claudeDesktopCookiesPath(homeDir, path)
	const exists = yield* fs.exists(cookiesPath).pipe(Effect.orElseSucceed(() => false))
	if (exists === false) {
		return yield* new ClaudeCookieDbError({
			reason: `Claude desktop cookies were not found at ${cookiesPath}`,
		})
	}

	const password = yield* keychain.findGenericPassword({
		service: CLAUDE_DESKTOP_COOKIE_SERVICE,
		account: CLAUDE_DESKTOP_COOKIE_ACCOUNT,
	})
	if (Option.isNone(password)) {
		return yield* new ClaudeCookieDbError({ reason: "Claude desktop cookie key was not found in Keychain" })
	}

	const key = yield* deriveChromiumCookieKey(password.value).pipe(
		Effect.mapError((error) => new ClaudeCookieDbError({ reason: error.message })),
	)
	const rows = yield* copyCookieDbAndReadRows(fs, path, cookiesPath).pipe(
		Effect.mapError((error) => new ClaudeCookieDbError({ reason: error.message })),
	)

	const cookies = new Map<string, string>()
	for (const row of rows) {
		if (WANTED_CLAUDE_COOKIE_NAMES.has(row.name) === false) {
			continue
		}
		const decrypted = yield* decryptChromiumCookieValue(row.encrypted_value, key).pipe(Effect.option)
		if (Option.isSome(decrypted)) {
			cookies.set(row.name, decrypted.value)
		}
	}

	if (cookies.has("sessionKey") === false) {
		return yield* new ClaudeCookieDbError({
			reason: "Claude desktop session cookie was not found; open Claude desktop and sign in",
		})
	}

	return cookies as ReadonlyMap<string, string>
})
