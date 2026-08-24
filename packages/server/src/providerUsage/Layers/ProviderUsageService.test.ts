import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Rec from "effect/Record"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { AppDataDir } from "../../rpc/fsPathGuard.ts"
import { deriveChromiumCookieKey } from "../claudeCookieCrypto.ts"
import { claudeDesktopCookiesPath } from "../claudeCookieDb.ts"
import { ProviderUsageService } from "../Services/ProviderUsageService.ts"
import { SecurityKeychain, type SecurityKeychainShape } from "../Services/SecurityKeychain.ts"
import { codexSessionsRoot } from "../codexUsage.ts"
import { ProviderUsageServiceLive } from "./ProviderUsageService.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const TEST_COOKIE_PASSWORD = "test-only-cookie-db-password"

const CLAUDE_ACCOUNT_JSON =
	'{"hasAvailableSubscription":true,"oauthAccount":{"organizationUuid":"org-1234","billingType":"stripe"}}'

const claudeUsageResponseBody =
	'{"five_hour":{"utilization":42,"resets_at":"2100-01-01T00:00:00Z"},"seven_day_opus":{"utilization":70,"resets_at":"4102448400"}}'

const codexRolloutLine = (usedPercent: number): string =>
	`{"timestamp":"2026-06-23T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":${String(usedPercent)},"window_minutes":300},"plan_type":"pro"}}}\n`

const fakeKeychain = (
	byService: Readonly<Record<string, string>>,
	calls?: { count: number },
): SecurityKeychainShape => ({
	findGenericPassword: (input) => {
		if (calls !== undefined) {
			calls.count += 1
		}
		const value = Rec.get(byService, input.service)
		return Effect.succeed(value)
	},
})

const httpResponding = (bodiesByUrl: Readonly<Record<string, string>>, calls?: { count: number }): HttpClient.HttpClient =>
	HttpClient.make((request, url) => {
		if (calls !== undefined) {
			calls.count += 1
		}
		const body = Rec.get(bodiesByUrl, url.href)
		if (Option.isNone(body)) {
			return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 })))
		}
		return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body.value, { status: 200 })))
	})

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

const writeFixtureCookieDb = Effect.fn("test.writeFixtureCookieDb")(function*(dbPath: string, key: Uint8Array) {
	yield* Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		yield* sql`PRAGMA journal_mode = DELETE`.withoutTransform
		yield* sql`CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB)`.withoutTransform
		const encrypted = yield* encryptCookieValue(key, "sess-cookie-value")
		yield* sql`INSERT INTO cookies (host_key, name, encrypted_value) VALUES (${"https://claude.ai"}, ${"sessionKey"}, ${encrypted})`
			.withoutTransform
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(SqliteClient.layer({ filename: dbPath, create: true, readwrite: true })),
	)
})

// Composes ProviderUsageServiceLive with its dependencies -- FileSystem/Path
// come from the ambient Vitest.layer(PlatformLive) context this file's
// tests all run inside, so only the OS-touching seams (Keychain, HTTP, the
// app-data dir) need explicit fakes here. Layer.provide (not mergeAll) is
// required: mergeAll runs sibling layers against the SAME outer context, it
// does not feed one sibling's output to another's requirements.
const usageLayerWith = (input: {
	readonly homeDir: string
	readonly appDataDirPath: string
	readonly keychain: SecurityKeychainShape
	readonly http: HttpClient.HttpClient
}) =>
	ProviderUsageServiceLive({ homeDir: input.homeDir }).pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(SecurityKeychain, input.keychain),
				Layer.succeed(HttpClient.HttpClient, input.http),
				Layer.succeed(AppDataDir, AppDataDir.of({ path: input.appDataDirPath })),
			),
		),
	)

const getUsageWith = <E, R>(
	layer: Layer.Layer<ProviderUsageService, E, R>,
	request: { readonly provider?: "codex" | "claude-code" | "cursor" },
) =>
	Effect.gen(function*() {
		const service = yield* ProviderUsageService
		return yield* service.getUsage(request)
	}).pipe(
		// Test-local: builds a fully self-contained ProviderUsageService (fakes
		// for every OS-touching seam) for one assertion, same shape as
		// gitCallHandler.test.ts's TestLive.
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(layer),
	)

// Every test below builds its own fully-isolated environment: a scoped temp
// "home" directory (Codex sessions, ~/.claude.json all resolve under it) and
// a scoped temp app-data directory (the disk usage cache). Every dependency
// that would otherwise touch the real OS -- Keychain, network, the real
// home directory -- is a fake or points at the temp dir.

Vitest.layer(PlatformLive)("ProviderUsageService", (it) => {
	it.effect("reports every provider unavailable when nothing is configured", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const appDataDirPath = yield* fs.makeTempDirectoryScoped()
			const usage = yield* getUsageWith(
				usageLayerWith({ homeDir, appDataDirPath, keychain: fakeKeychain({}), http: httpResponding({}) }),
				{},
			)

			Vitest.assert.strictEqual(usage.length, 3)
			for (const provider of usage) {
				Vitest.assert.strictEqual(provider.connection, "unavailable")
				Vitest.assert.deepStrictEqual(provider.windows, [])
				Vitest.assert.isNotNull(provider.message)
			}
			Vitest.assert.deepStrictEqual(usage.map((p) => p.providerId), ["codex", "claude-code", "cursor"])
		})
	)

	it.effect("reports Codex connected once a rollout file has rate-limit data", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const appDataDirPath = yield* fs.makeTempDirectoryScoped()
			const sessionsRoot = codexSessionsRoot(homeDir, path)
			yield* fs.makeDirectory(sessionsRoot, { recursive: true })
			yield* fs.writeFileString(path.join(sessionsRoot, "rollout-1.jsonl"), codexRolloutLine(33))

			const usage = yield* getUsageWith(
				usageLayerWith({ homeDir, appDataDirPath, keychain: fakeKeychain({}), http: httpResponding({}) }),
				{ provider: "codex" },
			)

			Vitest.assert.strictEqual(usage.length, 1)
			Vitest.assert.strictEqual(usage[0]?.providerId, "codex")
			Vitest.assert.strictEqual(usage[0]?.connection, "connected")
			Vitest.assert.strictEqual(usage[0]?.windows[0]?.usedFraction, 0.33)
		})
	)

	it.effect("reports Claude connected via a Keychain-held OAuth token, and caches it in-memory", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const appDataDirPath = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(homeDir, ".claude.json"), CLAUDE_ACCOUNT_JSON)

			const httpCalls = { count: 0 }
			const usageLayer = usageLayerWith({
				homeDir,
				appDataDirPath,
				keychain: fakeKeychain({
					"Claude Code-credentials": '{"claudeAiOauth":{"accessToken":"test-access-token"}}',
				}),
				http: httpResponding(
					{ "https://api.anthropic.com/api/oauth/usage": claudeUsageResponseBody },
					httpCalls,
				),
			})

			// Both calls run against the SAME built service instance (one
			// Effect.provide, not one per call) -- ProviderUsageServiceLive
			// builds its in-memory cache Ref once per layer construction, so this
			// is what actually exercises reuse within the cache's 30s TTL. Two
			// separate Effect.provide calls would each rebuild the layer (and its
			// Ref) from scratch, which is not how the RPC handler uses it.
			const { first, second } = yield* Effect.gen(function*() {
				const service = yield* ProviderUsageService
				const firstUsage = (yield* service.getUsage({ provider: "claude-code" }))[0]
				const secondUsage = (yield* service.getUsage({ provider: "claude-code" }))[0]
				return { first: firstUsage, second: secondUsage }
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(usageLayer),
			)

			Vitest.assert.strictEqual(first?.connection, "connected")
			Vitest.assert.strictEqual(first?.plan, "Claude Pro")
			Vitest.assert.strictEqual(first?.windows.length, 2)
			Vitest.assert.strictEqual(second?.connection, "connected")
			Vitest.assert.strictEqual(httpCalls.count, 1)
		})
	)

	it.effect("falls back to the Claude desktop cookie flow when no OAuth token is available", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const appDataDirPath = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(homeDir, ".claude.json"), CLAUDE_ACCOUNT_JSON)

			const cookiesPath = claudeDesktopCookiesPath(homeDir, path)
			yield* fs.makeDirectory(path.dirname(cookiesPath), { recursive: true })
			const key = yield* deriveChromiumCookieKey(TEST_COOKIE_PASSWORD)
			yield* writeFixtureCookieDb(cookiesPath, key)

			const usage = (yield* getUsageWith(
				usageLayerWith({
					homeDir,
					appDataDirPath,
					keychain: fakeKeychain({ "Claude Safe Storage": TEST_COOKIE_PASSWORD }),
					http: httpResponding({
						"https://claude.ai/api/organizations/org-1234/usage": claudeUsageResponseBody,
					}),
				}),
				{ provider: "claude-code" },
			))[0]

			Vitest.assert.strictEqual(usage?.connection, "connected")
			Vitest.assert.strictEqual(usage?.windows.length, 2)
		})
	)

	it.effect("falls back to the on-disk cache when the live Claude fetch fails after a prior success", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const appDataDirPath = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(homeDir, ".claude.json"), CLAUDE_ACCOUNT_JSON)

			const keychain = fakeKeychain({
				"Claude Code-credentials": '{"claudeAiOauth":{"accessToken":"test-access-token"}}',
			})

			// First layer instance: live fetch succeeds and persists a disk cache.
			const first = (yield* getUsageWith(
				usageLayerWith({
					homeDir,
					appDataDirPath,
					keychain,
					http: httpResponding({ "https://api.anthropic.com/api/oauth/usage": claudeUsageResponseBody }),
				}),
				{ provider: "claude-code" },
			))[0]
			Vitest.assert.strictEqual(first?.connection, "connected")

			// Second, FRESH layer instance (so its in-memory cache starts empty)
			// with a failing HTTP client -- must fall back to the disk cache the
			// first instance wrote, not go straight to unavailable.
			const second = (yield* getUsageWith(
				usageLayerWith({ homeDir, appDataDirPath, keychain, http: httpResponding({}) }),
				{ provider: "claude-code" },
			))[0]
			Vitest.assert.strictEqual(second?.connection, "connected")
			Vitest.assert.strictEqual(
				second?.message,
				"Showing cached Claude usage because live usage could not be refreshed",
			)
		})
	)

	it.effect("always reports Cursor unavailable", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const appDataDirPath = yield* fs.makeTempDirectoryScoped()
			const usage = yield* getUsageWith(
				usageLayerWith({ homeDir, appDataDirPath, keychain: fakeKeychain({}), http: httpResponding({}) }),
				{ provider: "cursor" },
			)
			Vitest.assert.strictEqual(usage.length, 1)
			Vitest.assert.strictEqual(usage[0]?.providerId, "cursor")
			Vitest.assert.strictEqual(usage[0]?.connection, "unavailable")
		})
	)
})
