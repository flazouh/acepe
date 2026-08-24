import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { codexSessionsRoot, findLatestCodexRateLimitSnapshot, parseLatestCodexSnapshotFromLines } from "./codexUsage.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)
const NOW_MS = 1_782_212_400_000

// Fixture lines are hand-written JSON text rather than JSON.stringify(...)
// output -- this repo's Effect lint (preferSchemaOverJson) bans JSON.parse/
// JSON.stringify in favor of Schema, and these are fixed shapes anyway.
const tokenCountLine = (input: {
	readonly timestamp?: string
	readonly usedPercentPrimary?: number
	readonly usedPercentSecondary?: number
	readonly planType?: string
}): string => {
	const timestamp = input.timestamp === undefined ? "" : `"timestamp":"${input.timestamp}",`
	const secondary =
		input.usedPercentSecondary === undefined
			? ""
			: `,"secondary":{"used_percent":${String(input.usedPercentSecondary)},"window_minutes":10080,"resets_at":1782820779}`
	const planType = input.planType === undefined ? "" : `,"plan_type":"${input.planType}"`
	return `{${timestamp}"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":${String(input.usedPercentPrimary ?? 0)},"window_minutes":300,"resets_at":1782251981}${secondary}${planType}}}}`
}

const sessionMetaLine = (timestamp: string): string => `{"timestamp":"${timestamp}","type":"session_meta","payload":{}}`

const nonTokenCountEventLine = (timestamp: string): string =>
	`{"timestamp":"${timestamp}","type":"event_msg","payload":{"type":"agent_message","text":"hi"}}`

Vitest.describe("parseLatestCodexSnapshotFromLines", () => {
	Vitest.it("parses the latest token_count event's rate limits from a rollout file", () => {
		const lines = [
			tokenCountLine({
				timestamp: "2026-06-23T10:00:00.000Z",
				usedPercentPrimary: 12.0,
				usedPercentSecondary: 80.0,
				planType: "pro",
			}),
			tokenCountLine({
				timestamp: "2026-06-23T11:00:00.000Z",
				usedPercentPrimary: 25.0,
				usedPercentSecondary: 81.0,
				planType: "pro",
			}),
		]

		const snapshot = parseLatestCodexSnapshotFromLines(lines, NOW_MS)

		Vitest.assert.isNotNull(snapshot)
		Vitest.assert.strictEqual(snapshot?.planType, "pro")
		Vitest.assert.strictEqual(snapshot?.capturedAtMs, 1_782_212_400_000)
		Vitest.assert.strictEqual(snapshot?.primary?.usedPercent, 25.0)
		Vitest.assert.strictEqual(snapshot?.secondary?.usedPercent, 81.0)
	})

	Vitest.it("skips malformed JSON lines and non-token_count events without failing", () => {
		const lines = [
			"not json at all {{{",
			"",
			"   ",
			sessionMetaLine("2026-06-23T10:00:00.000Z"),
			nonTokenCountEventLine("2026-06-23T10:05:00.000Z"),
			tokenCountLine({ timestamp: "2026-06-23T10:10:00.000Z", usedPercentPrimary: 5.0 }),
		]

		const snapshot = parseLatestCodexSnapshotFromLines(lines, NOW_MS)

		Vitest.assert.isNotNull(snapshot)
		Vitest.assert.strictEqual(snapshot?.primary?.usedPercent, 5.0)
		Vitest.assert.isNull(snapshot?.secondary ?? null)
	})

	Vitest.it("returns null when no token_count event is present", () => {
		const snapshot = parseLatestCodexSnapshotFromLines(
			[sessionMetaLine("2026-06-23T10:00:00.000Z")],
			NOW_MS,
		)
		Vitest.assert.isNull(snapshot)
	})

	Vitest.it("falls back to the supplied timestamp when the record's timestamp is missing", () => {
		const snapshot = parseLatestCodexSnapshotFromLines(
			[tokenCountLine({ usedPercentPrimary: 1 })],
			NOW_MS,
		)
		Vitest.assert.strictEqual(snapshot?.capturedAtMs, NOW_MS)
	})
})

Vitest.layer(PlatformLive)("codexUsage FS helpers", (it) => {
	it.effect("codexSessionsRoot joins .codex/sessions onto the home directory", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			Vitest.assert.strictEqual(
				codexSessionsRoot("/Users/alex", path),
				path.join("/Users/alex", ".codex", "sessions"),
			)
		})
	)

	it.effect("findLatestCodexRateLimitSnapshot returns null when the sessions root does not exist", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const snapshot = yield* findLatestCodexRateLimitSnapshot(
				fs,
				path,
				"/tmp/acepe-provider-usage-test/does-not-exist",
				NOW_MS,
			)
			Vitest.assert.isNull(snapshot)
		})
	)

	it.effect(
		"findLatestCodexRateLimitSnapshot picks the snapshot from the most recently modified rollout file, nested under subdirectories",
		() =>
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const root = yield* fs.makeTempDirectoryScoped()
				const sessionsRoot = path.join(root, "sessions")
				const oldDir = path.join(sessionsRoot, "2026", "06", "01")
				const newDir = path.join(sessionsRoot, "2026", "06", "02")
				yield* fs.makeDirectory(oldDir, { recursive: true })
				yield* fs.makeDirectory(newDir, { recursive: true })

				const oldFile = path.join(oldDir, "rollout-old.jsonl")
				const newFile = path.join(newDir, "rollout-new.jsonl")
				yield* fs.writeFileString(
					oldFile,
					`${tokenCountLine({ timestamp: "2026-06-01T00:00:00.000Z", usedPercentPrimary: 1, planType: "old" })}\n`,
				)
				yield* fs.writeFileString(
					newFile,
					`${tokenCountLine({ timestamp: "2026-06-02T00:00:00.000Z", usedPercentPrimary: 99, planType: "new" })}\n`,
				)
				// Force distinguishable mtimes directly instead of sleeping between
				// writes -- @effect/vitest's it.effect runs on the TestClock, where
				// Effect.sleep never resolves on its own.
				yield* fs.utimes(oldFile, NOW_MS - 60_000, NOW_MS - 60_000)
				yield* fs.utimes(newFile, NOW_MS, NOW_MS)

				const snapshot = yield* findLatestCodexRateLimitSnapshot(fs, path, sessionsRoot, NOW_MS)
				Vitest.assert.strictEqual(snapshot?.planType, "new")
			})
	)

	it.effect(
		"findLatestCodexRateLimitSnapshot falls through to an older file when the newest rollout has no usable snapshot",
		() =>
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const root = yield* fs.makeTempDirectoryScoped()
				const sessionsRoot = path.join(root, "sessions")
				yield* fs.makeDirectory(sessionsRoot, { recursive: true })

				const aFile = path.join(sessionsRoot, "rollout-a.jsonl")
				const bFile = path.join(sessionsRoot, "rollout-b.jsonl")
				yield* fs.writeFileString(
					aFile,
					`${tokenCountLine({ timestamp: "2026-06-01T00:00:00.000Z", usedPercentPrimary: 42, planType: "has-data" })}\n`,
				)
				yield* fs.writeFileString(bFile, "not usable jsonl\n")
				yield* fs.utimes(aFile, NOW_MS - 60_000, NOW_MS - 60_000)
				yield* fs.utimes(bFile, NOW_MS, NOW_MS)

				const snapshot = yield* findLatestCodexRateLimitSnapshot(fs, path, sessionsRoot, NOW_MS)
				Vitest.assert.strictEqual(snapshot?.planType, "has-data")
			})
	)
})
