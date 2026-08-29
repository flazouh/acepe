import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import type * as Path from "effect/Path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { modifiedAtMillis } from "../../skills/fsWalk.ts"
import { ClaudeJsonlLine, claudeFactFromLine, claudeSessionIdFromLine } from "../claude.ts"
import { decodeJsonl } from "../jsonl.ts"
import { sessionTitleFromUserText } from "../text.ts"
import { claudeProjectSlug, slugToPath } from "./Roots.ts"
import { DiscoveredProject, ScannedSession } from "./Types.ts"

/**
 * Read-time metadata scan (#249 batch 3) -- deliberately lighter than
 * `HistoryImporter`: it decodes a bounded prefix of each session file to
 * recover a title and creation time, and leans on `fs.stat` mtime (already
 * an O(1) syscall the Rust indexer itself used as its primary "changed"
 * signal) instead of parsing every line for the transcript's true end.
 * Nothing here dispatches orchestration commands or touches the event
 * store; that only happens on session-open import.
 */

const TITLE_SCAN_LINE_LIMIT = 40
export const MAX_SESSIONS_PER_PROJECT = 50

const mtimeDescending = Order.flip(
	Order.mapInput(Order.Number, (entry: { mtimeMs: number }) => entry.mtimeMs)
)

const decodeSession = Schema.decodeUnknownEffect(ScannedSession)
const decodeProject = Schema.decodeUnknownEffect(DiscoveredProject)
const decodeProjectPath = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

type ClaudeSessionContentScan = {
	readonly sessionId: Option.Option<string>
	readonly title: string
	readonly createdAtMs: Option.Option<number>
}

const epochMillisFromIso = (iso: string): Option.Option<number> =>
	Option.map(DateTime.make(iso), DateTime.toEpochMillis)

export const scanClaudeSessionContent = Effect.fn("scanClaudeSessionContent")(function*(
	content: string,
	filePath: string
) {
	const lines = Str.split(content, "\n")
	const prefix = Arr.join(Arr.take(lines, TITLE_SCAN_LINE_LIMIT), "\n")
	const decoded = yield* decodeJsonl(ClaudeJsonlLine, prefix, filePath)
	const sessionId = Option.flatMap(Arr.head(decoded.rows), claudeSessionIdFromLine)
	const facts = Arr.filterMap(decoded.rows, Filter.fromPredicateOption(claudeFactFromLine))
	const firstUserFact = Arr.findFirst(facts, (fact) => fact.role === "user")
	const title = sessionTitleFromUserText(Option.map(firstUserFact, (fact) => fact.text))
	const createdAtMs = Arr.head(
		Arr.filterMap(
			decoded.rows,
			Filter.fromPredicateOption((row: ClaudeJsonlLine) =>
				row.timestamp === undefined ? Option.none() : epochMillisFromIso(row.timestamp)
			)
		)
	)
	const result: ClaudeSessionContentScan = { sessionId, title, createdAtMs }
	return result
})

/**
 * Scans one Claude session JSONL file into a `ScannedSession`, tolerant
 * of malformed or unreadable content: any decode failure yields `None`
 * rather than failing the whole project scan, and the caller logs it.
 */
export const scanClaudeSessionFile = Effect.fn("scanClaudeSessionFile")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectPath: string,
	filePath: string
) {
	const stat = yield* fs.stat(filePath)
	const updatedAtMs = modifiedAtMillis(stat.mtime)
	const content = yield* fs.readFileString(filePath)
	const scan = yield* scanClaudeSessionContent(content, filePath)
	const stem = path.basename(filePath, ".jsonl")
	const sessionId = Option.getOrElse(scan.sessionId, () => stem)
	const createdAtMs = Option.getOrElse(scan.createdAtMs, () => updatedAtMs)
	const candidate = yield* Effect.result(
		decodeSession({
			id: sessionId,
			title: scan.title,
			provider: "claude",
			projectPath,
			createdAtMs: Math.trunc(createdAtMs),
			updatedAtMs: Math.trunc(updatedAtMs),
			sourcePath: filePath
		})
	)
	if (Result.isFailure(candidate)) {
		yield* Effect.logWarning("Skipped unscannable Claude session file").pipe(
			Effect.annotateLogs({ filePath, reason: candidate.failure.message })
		)
		return Option.none<ScannedSession>()
	}
	return Option.some(candidate.success)
})

export const jsonlNamesIn = Effect.fn("jsonlNamesIn")(function*(
	fs: FileSystem.FileSystem,
	directory: string
) {
	const exists = yield* fs.exists(directory)
	if (exists === false) {
		return Arr.empty<string>()
	}
	const info = yield* fs.stat(directory)
	if (info.type !== "Directory") {
		return Arr.empty<string>()
	}
	const names = yield* fs.readDirectory(directory)
	return Arr.filter(names, Str.endsWith(".jsonl"))
})

/**
 * Cheap cache-invalidation signature for one project's Claude session
 * directory: the sorted `name:mtimeMs` pairs of its `.jsonl` files. Two
 * scans with the same signature are guaranteed to produce the same
 * `ScannedSession` list, so callers can skip the real scan when it is
 * unchanged.
 */
export const projectDirectorySignature = Effect.fn("projectDirectorySignature")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectsRoot: string,
	projectPath: string
) {
	const slug = yield* claudeProjectSlug(fs, projectPath)
	const projectDir = path.join(projectsRoot, slug)
	const jsonlNames = yield* jsonlNamesIn(fs, projectDir)
	const sorted = Arr.sort(jsonlNames, Str.Order)
	const stamps = yield* Effect.forEach(sorted, (name) =>
		Effect.map(fs.stat(path.join(projectDir, name)), (stat) => `${name}:${modifiedAtMillis(stat.mtime)}`))
	return Arr.join(stamps, "|")
})

/**
 * Cheap cache-invalidation signature for the whole Claude projects root:
 * the sorted `slug:mtimeMs` pairs of its project directories.
 */
export const rootDirectorySignature = Effect.fn("rootDirectorySignature")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectsRoot: string
) {
	const exists = yield* fs.exists(projectsRoot)
	if (exists === false) {
		return "missing"
	}
	const info = yield* fs.stat(projectsRoot)
	if (info.type !== "Directory") {
		return "missing"
	}
	const slugNames = yield* fs.readDirectory(projectsRoot)
	const sorted = Arr.sort(slugNames, Str.Order)
	const stamps = yield* Effect.forEach(sorted, (slug) =>
		Effect.map(fs.stat(path.join(projectsRoot, slug)), (stat) => `${slug}:${modifiedAtMillis(stat.mtime)}`))
	return Arr.join(stamps, "|")
})

/**
 * Lists the Claude sessions discovered for one project, most-recently
 * modified first and capped at `MAX_SESSIONS_PER_PROJECT` -- the same
 * recency cap `IndexerActor::handle_full_scan` applied in the Rust indexer.
 * Returns an empty list (not an error) when the project has no Claude
 * history yet; that is the normal case, not a failure.
 */
export const listClaudeSessionsForProject = Effect.fn("listClaudeSessionsForProject")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectsRoot: string,
	projectPath: string
) {
	const slug = yield* claudeProjectSlug(fs, projectPath)
	const projectDir = path.join(projectsRoot, slug)
	const jsonlNames = yield* jsonlNamesIn(fs, projectDir)
	const withMtime = yield* Effect.forEach(jsonlNames, (name) =>
		Effect.gen(function*() {
			const absolute = path.join(projectDir, name)
			const stat = yield* fs.stat(absolute)
			return { absolute, mtimeMs: modifiedAtMillis(stat.mtime) }
		}))
	const capped = Arr.take(Arr.sort(withMtime, mtimeDescending), MAX_SESSIONS_PER_PROJECT)
	const scanned = yield* Effect.forEach(capped, (entry) =>
		Effect.result(scanClaudeSessionFile(fs, path, projectPath, entry.absolute)))
	const sessions = Arr.filterMap(
		scanned,
		Filter.fromPredicateOption((outcome: Result.Result<Option.Option<ScannedSession>, unknown>) => {
			if (Result.isFailure(outcome)) {
				return Option.none()
			}
			return outcome.success
		})
	)
	return sessions
})

/**
 * Lists every project directory Claude Code has session history for,
 * independent of Acepe's own project registry -- this is the discovery
 * primitive `listAllProjectPaths`/`getStartupSessions` need, since a
 * session the user opened outside Acepe is still on disk under its own
 * slug even though Acepe never registered that project path.
 */
export const listClaudeProjects = Effect.fn("listClaudeProjects")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectsRoot: string
) {
	const exists = yield* fs.exists(projectsRoot)
	if (exists === false) {
		return Arr.empty<DiscoveredProject>()
	}
	const rootInfo = yield* fs.stat(projectsRoot)
	if (rootInfo.type !== "Directory") {
		return Arr.empty<DiscoveredProject>()
	}
	const slugNames = yield* fs.readDirectory(projectsRoot)
	const projects = yield* Effect.forEach(slugNames, (slug) =>
		Effect.gen(function*() {
			const slugDir = path.join(projectsRoot, slug)
			const info = yield* fs.stat(slugDir)
			if (info.type !== "Directory") {
				return Option.none<DiscoveredProject>()
			}
			const jsonlNames = yield* jsonlNamesIn(fs, slugDir)
			if (jsonlNames.length === 0) {
				return Option.none<DiscoveredProject>()
			}
			const mtimes = yield* Effect.forEach(jsonlNames, (name) =>
				Effect.map(fs.stat(path.join(slugDir, name)), (stat) => modifiedAtMillis(stat.mtime)))
			const lastActiveMs = Arr.reduce(mtimes, 0, (max, value) => (value > max ? value : max))
			const projectPathResult = yield* Effect.result(decodeProjectPath(slugToPath(slug)))
			if (Result.isFailure(projectPathResult)) {
				yield* Effect.logWarning("Skipped Claude project slug that decoded to an empty path").pipe(
					Effect.annotateLogs({ slugDir, reason: projectPathResult.failure.message })
				)
				return Option.none<DiscoveredProject>()
			}
			const candidate = yield* Effect.result(
				decodeProject({
					projectPath: projectPathResult.success,
					provider: "claude",
					sessionCount: jsonlNames.length,
					lastActiveMs: Math.trunc(lastActiveMs)
				})
			)
			if (Result.isFailure(candidate)) {
				yield* Effect.logWarning("Skipped unscannable Claude project directory").pipe(
					Effect.annotateLogs({ slugDir, reason: candidate.failure.message })
				)
				return Option.none<DiscoveredProject>()
			}
			return Option.some(candidate.success)
		}))
	return Arr.getSomes(projects)
})
