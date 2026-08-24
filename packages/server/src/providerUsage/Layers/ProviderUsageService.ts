import { type GetProviderAccountUsageRequest, type ProviderAccountUsage, RpcProviderUsageError } from "@acepe/contracts"
import * as Clock from "effect/Clock"
import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { decodeClaudeAccountConfigJson, decodeClaudeCodeCredentialsJson } from "../claudeAccount.ts"
import { readClaudeSessionCookies } from "../claudeCookieDb.ts"
import { ClaudeUsageApiResponse } from "../claudeUsageApi.ts"
import {
	CLAUDE_USAGE_CACHE_TTL_MS,
	type ClaudeUsageSnapshotCache,
	decodeClaudeUsageSnapshotCacheJson,
	encodeClaudeUsageSnapshotCacheJson,
} from "../claudeUsageCache.ts"
import { codexSessionsRoot, findLatestCodexRateLimitSnapshot } from "../codexUsage.ts"
import { AppDataDir } from "../../rpc/fsPathGuard.ts"
import { SecurityKeychain, type SecurityKeychainShape } from "../Services/SecurityKeychain.ts"
import { ProviderUsageService } from "../Services/ProviderUsageService.ts"
import { claudePlanLabel, claudeUsageResponseToWindows, claudeWindowsToProviderUsage, codexSnapshotToProviderUsage, unavailableProvider } from "../usageMapping.ts"

// Ported end to end from provider_account_usage/mod.rs's
// get_provider_account_usage: Codex reads ~/.codex/sessions directly off
// disk; Claude Code prefers the OAuth token from Keychain (or its
// credentials file fallback), and falls back to the Claude desktop app's
// session cookie when neither is available; Cursor always reports
// unavailable pending an account API. A live-fetch failure for Claude falls
// back to the last cached snapshot (memory first, then disk) before
// reporting unavailable -- see loadClaudeUsage.

const CLAUDE_CODE_CREDENTIALS_SERVICE = "Claude Code-credentials"
const CLAUDE_USAGE_API_PLATFORM = "web_claude_ai"
const CLAUDE_OAUTH_USAGE_BETA = "oauth-2025-04-20"
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const CLAUDE_DESKTOP_USAGE_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const HTTP_TIMEOUT = Duration.seconds(10)

export class ClaudeUsageError extends Schema.TaggedError<ClaudeUsageError>()("ClaudeUsageError", {
	reason: Schema.String,
}) {
	override get message(): string {
		return this.reason
	}
}

const toClaudeUsageError = (error: { readonly message: string }): ClaudeUsageError =>
	new ClaudeUsageError({ reason: error.message })

// ─── Claude account / OAuth token / cookie fallback ───────────────────────

const claudeAccountConfigPath = (homeDir: string, path: Path.Path): string => path.join(homeDir, ".claude.json")

const claudeCodeCredentialsFilePath = (homeDir: string, path: Path.Path): string =>
	path.join(homeDir, ".claude", ".credentials.json")

const readClaudeAccountConfig = Effect.fn("providerUsage.readClaudeAccountConfig")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
) {
	const content = yield* fs.readFileString(claudeAccountConfigPath(homeDir, path)).pipe(
		Effect.mapError(toClaudeUsageError),
	)
	return yield* decodeClaudeAccountConfigJson(content).pipe(Effect.mapError(toClaudeUsageError))
})

const accessTokenFromCredentials = (raw: string): Effect.Effect<Option.Option<string>> =>
	decodeClaudeCodeCredentialsJson(raw).pipe(
		Effect.map((credentials) => {
			const token = credentials.claudeAiOauth?.accessToken?.trim()
			return token === undefined || token.length === 0 ? Option.none<string>() : Option.some(token)
		}),
		Effect.orElseSucceed(() => Option.none<string>()),
	)

const readClaudeCodeOAuthAccessTokenFromKeychain = Effect.fn(
	"providerUsage.readClaudeCodeOAuthAccessTokenFromKeychain",
)(function*(keychain: SecurityKeychainShape) {
	const raw = yield* keychain.findGenericPassword({ service: CLAUDE_CODE_CREDENTIALS_SERVICE })
	if (Option.isNone(raw)) {
		return Option.none<string>()
	}
	return yield* accessTokenFromCredentials(raw.value)
})

const readClaudeCodeOAuthAccessTokenFromFile = Effect.fn(
	"providerUsage.readClaudeCodeOAuthAccessTokenFromFile",
)(function*(fs: FileSystem.FileSystem, path: Path.Path, homeDir: string) {
	const filePath = claudeCodeCredentialsFilePath(homeDir, path)
	const content = yield* fs.readFileString(filePath).pipe(Effect.option)
	if (Option.isNone(content)) {
		return Option.none<string>()
	}
	return yield* accessTokenFromCredentials(content.value)
})

const readClaudeCodeOAuthAccessToken = Effect.fn("providerUsage.readClaudeCodeOAuthAccessToken")(function*(
	keychain: SecurityKeychainShape,
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
) {
	const fromKeychain = yield* readClaudeCodeOAuthAccessTokenFromKeychain(keychain)
	if (Option.isSome(fromKeychain)) {
		return fromKeychain
	}
	return yield* readClaudeCodeOAuthAccessTokenFromFile(fs, path, homeDir)
})

const organizationUuidFromAccount = (account: { readonly oauthAccount?: { readonly organizationUuid?: string | null } | null }): string | null => {
	const raw = account.oauthAccount?.organizationUuid?.trim()
	return raw === undefined || raw === null || raw.length === 0 ? null : raw
}

// ─── Claude usage HTTP calls ───────────────────────────────────────────────

const fetchClaudeOAuthUsageApi = Effect.fn("providerUsage.fetchClaudeOAuthUsageApi")(function*(
	http: HttpClient.HttpClient,
	accessToken: string,
) {
	const response = yield* http
		.get(CLAUDE_OAUTH_USAGE_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"anthropic-beta": CLAUDE_OAUTH_USAGE_BETA,
			},
		})
		.pipe(Effect.timeout(HTTP_TIMEOUT), Effect.mapError(toClaudeUsageError))
	return yield* HttpClientResponse.schemaBodyJson(ClaudeUsageApiResponse)(response).pipe(
		Effect.mapError(toClaudeUsageError),
	)
})

const cookieHeaderFrom = (cookies: ReadonlyMap<string, string>): string =>
	Array.from(cookies.entries())
		.map(([name, value]) => `${name}=${value}`)
		.join("; ")

const fetchClaudeDesktopUsageApi = Effect.fn("providerUsage.fetchClaudeDesktopUsageApi")(function*(
	http: HttpClient.HttpClient,
	organizationUuid: string,
	cookies: ReadonlyMap<string, string>,
) {
	const response = yield* http
		.get(`https://claude.ai/api/organizations/${organizationUuid}/usage`, {
			headers: {
				Cookie: cookieHeaderFrom(cookies),
				"User-Agent": CLAUDE_DESKTOP_USAGE_USER_AGENT,
				"Content-Type": "application/json",
				Referer: "https://claude.ai/settings/usage",
				"anthropic-client-platform": CLAUDE_USAGE_API_PLATFORM,
			},
		})
		.pipe(Effect.timeout(HTTP_TIMEOUT), Effect.mapError(toClaudeUsageError))
	return yield* HttpClientResponse.schemaBodyJson(ClaudeUsageApiResponse)(response).pipe(
		Effect.mapError(toClaudeUsageError),
	)
})

// ─── Claude snapshot: live fetch, memory cache, disk cache ────────────────

type ClaudeUsageDeps = {
	readonly fs: FileSystem.FileSystem
	readonly path: Path.Path
	readonly http: HttpClient.HttpClient
	readonly keychain: SecurityKeychainShape
	readonly homeDir: string
	readonly appDataDirPath: string
}

const loadClaudeUsageSnapshotLive = Effect.fn("providerUsage.loadClaudeUsageSnapshotLive")(function*(
	deps: ClaudeUsageDeps,
) {
	const account = yield* readClaudeAccountConfig(deps.fs, deps.path, deps.homeDir)
	const plan = claudePlanLabel({
		hasAvailableSubscription: account.hasAvailableSubscription ?? false,
		billingType: account.oauthAccount?.billingType ?? null,
	})

	const accessToken = yield* readClaudeCodeOAuthAccessToken(deps.keychain, deps.fs, deps.path, deps.homeDir)
	const response = yield* Option.isSome(accessToken)
		? fetchClaudeOAuthUsageApi(deps.http, accessToken.value)
		: Effect.gen(function*() {
				const organizationUuid = organizationUuidFromAccount(account)
				if (organizationUuid === null) {
					return yield* new ClaudeUsageError({
						reason: "Claude Code account is missing an organization id in ~/.claude.json",
					})
				}
				const cookies = yield* readClaudeSessionCookies(deps.fs, deps.path, deps.keychain, deps.homeDir).pipe(
					Effect.mapError(toClaudeUsageError),
				)
				return yield* fetchClaudeDesktopUsageApi(deps.http, organizationUuid, cookies)
			})

	const nowMs = yield* Clock.currentTimeMillis
	const windows = claudeUsageResponseToWindows(response, nowMs)
	if (windows.length === 0) {
		return yield* new ClaudeUsageError({ reason: "Claude usage API returned no quota windows" })
	}
	return { capturedAtMs: nowMs, plan, windows } satisfies ClaudeUsageSnapshotCache
})

const claudeUsageDiskCachePath = (appDataDirPath: string, path: Path.Path): string =>
	path.join(appDataDirPath, "provider-account-usage", "claude-code-usage.json")

const persistClaudeUsageDiskCache = Effect.fn("providerUsage.persistClaudeUsageDiskCache")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	appDataDirPath: string,
	snapshot: ClaudeUsageSnapshotCache,
) {
	const filePath = claudeUsageDiskCachePath(appDataDirPath, path)
	yield* fs.makeDirectory(path.dirname(filePath), { recursive: true })
	const json = yield* encodeClaudeUsageSnapshotCacheJson(snapshot)
	yield* fs.writeFileString(filePath, json)
})

const readClaudeUsageDiskCache = Effect.fn("providerUsage.readClaudeUsageDiskCache")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	appDataDirPath: string,
) {
	const filePath = claudeUsageDiskCachePath(appDataDirPath, path)
	const content = yield* fs.readFileString(filePath).pipe(Effect.option)
	if (Option.isNone(content)) {
		return Option.none<ClaudeUsageSnapshotCache>()
	}
	return yield* decodeClaudeUsageSnapshotCacheJson(content.value).pipe(Effect.option)
})

type ClaudeMemoryCacheEntry = {
	readonly storedAtMs: number
	readonly snapshot: ClaudeUsageSnapshotCache
}

const loadClaudeUsageSnapshotCached = Effect.fn("providerUsage.loadClaudeUsageSnapshotCached")(function*(
	deps: ClaudeUsageDeps,
	memoryCache: Ref.Ref<Option.Option<ClaudeMemoryCacheEntry>>,
) {
	const nowMs = yield* Clock.currentTimeMillis
	const cached = yield* Ref.get(memoryCache)
	if (Option.isSome(cached) && nowMs - cached.value.storedAtMs < CLAUDE_USAGE_CACHE_TTL_MS) {
		return cached.value.snapshot
	}
	const snapshot = yield* loadClaudeUsageSnapshotLive(deps)
	yield* Ref.set(memoryCache, Option.some({ storedAtMs: nowMs, snapshot }))
	yield* persistClaudeUsageDiskCache(deps.fs, deps.path, deps.appDataDirPath, snapshot).pipe(Effect.ignore)
	return snapshot
})

const CLAUDE_CACHED_USAGE_MESSAGE = "Showing cached Claude usage because live usage could not be refreshed"

const loadClaudeUsage = Effect.fn("providerUsage.loadClaudeUsage")(function*(
	deps: ClaudeUsageDeps,
	memoryCache: Ref.Ref<Option.Option<ClaudeMemoryCacheEntry>>,
) {
	const outcome = yield* Effect.result(loadClaudeUsageSnapshotCached(deps, memoryCache))
	if (Result.isSuccess(outcome)) {
		return claudeWindowsToProviderUsage(outcome.success.windows, outcome.success.plan, outcome.success.capturedAtMs, null)
	}

	const cached = yield* readClaudeUsageDiskCache(deps.fs, deps.path, deps.appDataDirPath)
	if (Option.isSome(cached)) {
		return claudeWindowsToProviderUsage(
			cached.value.windows,
			cached.value.plan,
			cached.value.capturedAtMs,
			CLAUDE_CACHED_USAGE_MESSAGE,
		)
	}

	const nowMs = yield* Clock.currentTimeMillis
	const detail = new RpcProviderUsageError({ provider: "claude-code", detail: outcome.failure.message }).message
	return unavailableProvider("claude-code", "Claude Code", detail, nowMs)
})

// ─── Codex ──────────────────────────────────────────────────────────────

const loadCodexUsage = Effect.fn("providerUsage.loadCodexUsage")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
) {
	const nowMs = yield* Clock.currentTimeMillis
	const sessionsRoot = codexSessionsRoot(homeDir, path)
	const exists = yield* fs.exists(sessionsRoot).pipe(Effect.orElseSucceed(() => false))
	if (exists === false) {
		return unavailableProvider("codex", "Codex", "No ~/.codex/sessions directory was found", nowMs)
	}

	const snapshot = yield* findLatestCodexRateLimitSnapshot(fs, path, sessionsRoot, nowMs)
	if (snapshot === null) {
		return unavailableProvider("codex", "Codex", "No Codex rate limit events were found", nowMs)
	}
	return codexSnapshotToProviderUsage(snapshot)
})

// ─── Cursor ─────────────────────────────────────────────────────────────

const loadCursorUsage = Effect.fn("providerUsage.loadCursorUsage")(function*() {
	const nowMs = yield* Clock.currentTimeMillis
	return unavailableProvider("cursor", "Cursor", "Cursor quota needs the Cursor account API", nowMs)
})

// ─── Wiring ─────────────────────────────────────────────────────────────

export type ProviderUsageServiceLiveOptions = {
	// Overrides the home directory Codex/Claude paths are resolved under.
	// Tests pass a scoped temp directory here instead of reading the real
	// HOME -- production always omits this and falls back to Config.
	readonly homeDir?: string
}

const wantsProvider = (request: GetProviderAccountUsageRequest, providerId: string): boolean =>
	request.provider === undefined || request.provider === providerId

export const makeProviderUsageService = Effect.fn("ProviderUsageService.make")(function*(
	options: ProviderUsageServiceLiveOptions,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
	const keychain = yield* SecurityKeychain
	const appDataDir = yield* AppDataDir
	const homeDir = options.homeDir === undefined
		? yield* Config.string("HOME").pipe(Config.orElse(() => Config.string("USERPROFILE")))
		: options.homeDir
	const memoryCache = yield* Ref.make(Option.none<ClaudeMemoryCacheEntry>())

	const claudeDeps: ClaudeUsageDeps = { fs, path, http, keychain, homeDir, appDataDirPath: appDataDir.path }

	const getUsage = (request: GetProviderAccountUsageRequest): Effect.Effect<ReadonlyArray<ProviderAccountUsage>> =>
		Effect.gen(function*() {
			const results: Array<ProviderAccountUsage> = []
			if (wantsProvider(request, "codex")) {
				results.push(yield* loadCodexUsage(fs, path, homeDir))
			}
			if (wantsProvider(request, "claude-code")) {
				results.push(yield* loadClaudeUsage(claudeDeps, memoryCache))
			}
			if (wantsProvider(request, "cursor")) {
				results.push(yield* loadCursorUsage())
			}
			return results
		})

	return ProviderUsageService.of({ getUsage })
})

export const ProviderUsageServiceLive = (options: ProviderUsageServiceLiveOptions = {}) =>
	Layer.effect(ProviderUsageService, makeProviderUsageService(options))
