import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import type * as Path from "effect/Path"

// Ported from packages/desktop/src-tauri/src/provider_account_usage/mod.rs's
// Codex half: walk ~/.codex/sessions for rollout-*.jsonl files (Codex's own
// session log format, not Acepe's), pick the most recently modified one, and
// read its last "token_count" event_msg for the current rate-limit windows.
// Malformed lines and unrelated event types are skipped, not fatal --
// tolerant parsing matches the Rust side's `let Ok(...) else { continue }`
// chains.

const CODEX_ROLLOUT_PREFIX = "rollout-"
const CODEX_ROLLOUT_SUFFIX = ".jsonl"

export type CodexRateLimitWindow = {
	readonly usedPercent: number
	readonly windowMinutes: number
	// Seconds since epoch, straight off the wire -- callers convert to ms.
	readonly resetsAtSeconds: number | null
}

export type CodexRateLimitSnapshot = {
	readonly planType: string | null
	readonly capturedAtMs: number
	readonly primary: CodexRateLimitWindow | null
	readonly secondary: CodexRateLimitWindow | null
}

type UnknownRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null && Array.isArray(value) === false

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)

const asFiniteNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null

const parseJsonRecord = (line: string): UnknownRecord | null => {
	try {
		const parsed: unknown = JSON.parse(line)
		return isRecord(parsed) ? parsed : null
	} catch {
		return null
	}
}

const parseIsoTimestampMs = (value: unknown, fallbackMs: number): number => {
	const text = asString(value)
	if (text === null) {
		return fallbackMs
	}
	return Option.match(DateTime.make(text), {
		onNone: () => fallbackMs,
		onSome: (dt) => DateTime.toEpochMillis(dt),
	})
}

const parseCodexWindow = (value: unknown): CodexRateLimitWindow | null => {
	if (isRecord(value) === false) {
		return null
	}
	const usedPercent = asFiniteNumber(value.used_percent)
	const windowMinutes = asFiniteNumber(value.window_minutes)
	if (usedPercent === null || windowMinutes === null) {
		return null
	}
	return {
		usedPercent,
		windowMinutes,
		resetsAtSeconds: asFiniteNumber(value.resets_at),
	}
}

// Scans rollout JSONL lines (oldest to newest, as the file is written) and
// returns the LATEST "token_count" event's rate limits, or null if the file
// has none. A malformed line, a non-event_msg record, or a non-token_count
// payload is skipped rather than aborting the scan.
export const parseLatestCodexSnapshotFromLines = (
	lines: ReadonlyArray<string>,
	fallbackCapturedAtMs: number,
): CodexRateLimitSnapshot | null => {
	let latest: CodexRateLimitSnapshot | null = null

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (line.length === 0) {
			continue
		}
		const record = parseJsonRecord(line)
		if (record === null) {
			continue
		}
		if (record.type !== "event_msg") {
			continue
		}
		const payload = record.payload
		if (isRecord(payload) === false || payload.type !== "token_count") {
			continue
		}
		const rateLimits = payload.rate_limits
		if (isRecord(rateLimits) === false) {
			continue
		}

		latest = {
			planType: asString(rateLimits.plan_type),
			capturedAtMs: parseIsoTimestampMs(record.timestamp, fallbackCapturedAtMs),
			primary: parseCodexWindow(rateLimits.primary),
			secondary: parseCodexWindow(rateLimits.secondary),
		}
	}

	return latest
}

const isRolloutFileName = (name: string): boolean =>
	name.startsWith(CODEX_ROLLOUT_PREFIX) && name.endsWith(CODEX_ROLLOUT_SUFFIX)

const modifiedAtMillis = (mtime: Option.Option<{ readonly getTime: () => number }>): number =>
	Option.match(mtime, {
		onNone: () => 0,
		onSome: (value) => value.getTime(),
	})

const byModifiedDescending = Order.flip(
	Order.mapInput(Order.Number, (entry: { readonly modifiedMs: number }) => entry.modifiedMs),
)

const parseLatestSnapshotFromRolloutFile = Effect.fn("providerUsage.parseLatestSnapshotFromRolloutFile")(
	function*(fs: FileSystem.FileSystem, filePath: string, fallbackCapturedAtMs: number) {
		const content = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""))
		if (content.length === 0) {
			return null
		}
		return parseLatestCodexSnapshotFromLines(content.split("\n"), fallbackCapturedAtMs)
	},
)

// Finds the most recently modified rollout-*.jsonl file anywhere under
// sessionsRoot (Codex nests these under date-stamped subdirectories) and
// returns the latest rate-limit snapshot from it. Falls through to older
// files only if the newest one has no usable snapshot, mirroring the Rust
// side's "sort by mtime desc, take the first file with a snapshot" loop.
export const findLatestCodexRateLimitSnapshot = Effect.fn("providerUsage.findLatestCodexRateLimitSnapshot")(
	function*(fs: FileSystem.FileSystem, path: Path.Path, sessionsRoot: string, nowMs: number) {
		const exists = yield* fs.exists(sessionsRoot).pipe(Effect.orElseSucceed(() => false))
		if (exists === false) {
			return null
		}

		const entries = yield* fs
			.readDirectory(sessionsRoot, { recursive: true })
			.pipe(Effect.orElseSucceed(() => Arr.empty<string>()))
		const rolloutEntries = Arr.filter(entries, (entry) => isRolloutFileName(path.basename(entry)))

		const withModifiedAt = yield* Effect.forEach(rolloutEntries, (entry) => {
			const filePath = path.join(sessionsRoot, entry)
			return fs.stat(filePath).pipe(
				Effect.map((info) => ({ filePath, modifiedMs: modifiedAtMillis(info.mtime) })),
				Effect.orElseSucceed(() => ({ filePath, modifiedMs: 0 })),
			)
		})
		const sorted = Arr.sort(withModifiedAt, byModifiedDescending)

		for (const entry of sorted) {
			const snapshot = yield* parseLatestSnapshotFromRolloutFile(fs, entry.filePath, nowMs)
			if (snapshot !== null) {
				return snapshot
			}
		}

		return null
	},
)

export const codexSessionsRoot = (homeDir: string, path: Path.Path): string =>
	path.join(homeDir, ".codex", "sessions")
