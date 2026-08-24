import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import {
	listClaudeProjects,
	listClaudeSessionsForProject,
	projectDirectorySignature,
	scanClaudeSessionContent
} from "./Scan.ts"
import { pathToSlug } from "./Roots.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const claudeLine = (fields: Record<string, unknown>): string => JSON.stringify(fields)

const writeSession = Effect.fn("writeSession")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectDir: string,
	fileName: string,
	lines: ReadonlyArray<Record<string, unknown>>
) {
	yield* fs.makeDirectory(projectDir, { recursive: true })
	const content = lines.map(claudeLine).join("\n")
	yield* fs.writeFileString(path.join(projectDir, fileName), content)
})

Vitest.layer(Platform)("scanClaudeSessionContent", (it) => {
	it.effect("recovers session id, title from the first user message, and created-at", () =>
		Effect.gen(function*() {
			const content = [
				claudeLine({
					type: "user",
					sessionId: "session-1",
					timestamp: "2026-08-20T10:00:00.000Z",
					message: { role: "user", content: "Fix the login bug" }
				}),
				claudeLine({
					type: "assistant",
					sessionId: "session-1",
					timestamp: "2026-08-20T10:00:05.000Z",
					message: { role: "assistant", content: "Looking into it." }
				})
			].join("\n")
			const scan = yield* scanClaudeSessionContent(content, "/fake/session-1.jsonl")
			Vitest.assert.deepStrictEqual(scan.sessionId, Option.some("session-1"))
			Vitest.assert.strictEqual(scan.title, "Fix the login bug")
			Vitest.assert.isTrue(Option.isSome(scan.createdAtMs))
		}))

	it.effect("is tolerant of malformed lines and still recovers what it can", () =>
		Effect.gen(function*() {
			const content = [
				"not json at all",
				claudeLine({
					type: "user",
					sessionId: "session-2",
					timestamp: "2026-08-20T11:00:00.000Z",
					message: { role: "user", content: "Second session title" }
				})
			].join("\n")
			const scan = yield* scanClaudeSessionContent(content, "/fake/session-2.jsonl")
			Vitest.assert.strictEqual(scan.title, "Second session title")
		}))

	it.effect("falls back to the untitled placeholder when no user text is found", () =>
		Effect.gen(function*() {
			const content = claudeLine({ type: "system", sessionId: "session-3" })
			const scan = yield* scanClaudeSessionContent(content, "/fake/session-3.jsonl")
			Vitest.assert.strictEqual(scan.title, "Untitled conversation")
		}))
})

Vitest.layer(Platform)("listClaudeSessionsForProject / listClaudeProjects", (it) => {
	it.effect("discovers every session file under the project's slug directory", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const projectsRoot = path.join(root, "projects")
			const projectPath = "/Users/example/acme"
			const slug = pathToSlug(projectPath)
			const projectDir = path.join(projectsRoot, slug)

			yield* writeSession(fs, path, projectDir, "session-a.jsonl", [
				{
					type: "user",
					sessionId: "session-a",
					timestamp: "2026-08-20T10:00:00.000Z",
					message: { role: "user", content: "First session" }
				}
			])
			yield* writeSession(fs, path, projectDir, "session-b.jsonl", [
				{
					type: "user",
					sessionId: "session-b",
					timestamp: "2026-08-20T12:00:00.000Z",
					message: { role: "user", content: "Second session" }
				}
			])

			const sessions = yield* listClaudeSessionsForProject(fs, path, projectsRoot, projectPath)
			Vitest.assert.strictEqual(sessions.length, 2)
			const ids = sessions.map((session) => session.id).toSorted()
			Vitest.assert.deepStrictEqual(ids, ["session-a", "session-b"])
			for (const session of sessions) {
				Vitest.assert.strictEqual(session.provider, "claude")
				Vitest.assert.strictEqual(session.projectPath, projectPath)
			}
		}))

	it.effect("returns an empty list, not an error, when the project has no Claude history", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const projectsRoot = path.join(root, "projects")
			const sessions = yield* listClaudeSessionsForProject(
				fs,
				path,
				projectsRoot,
				"/Users/example/never-opened"
			)
			Vitest.assert.deepStrictEqual(sessions, [])
		}))

	it.effect("lists every project directory independent of any registry", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const projectsRoot = path.join(root, "projects")
			const projectOne = "/Users/example/one"
			const projectTwo = "/Users/example/two"

			yield* writeSession(fs, path, path.join(projectsRoot, pathToSlug(projectOne)), "s1.jsonl", [
				{ type: "user", sessionId: "s1", message: { role: "user", content: "hi" } }
			])
			yield* writeSession(fs, path, path.join(projectsRoot, pathToSlug(projectTwo)), "s2.jsonl", [
				{ type: "user", sessionId: "s2", message: { role: "user", content: "hi" } }
			])

			const projects = yield* listClaudeProjects(fs, path, projectsRoot)
			const paths = projects.map((project) => project.projectPath).toSorted()
			Vitest.assert.deepStrictEqual(paths, [projectOne, projectTwo])
		}))

	it.effect("changes signature when the project's session files change", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const projectsRoot = path.join(root, "projects")
			const projectPath = "/Users/example/acme"
			const projectDir = path.join(projectsRoot, pathToSlug(projectPath))

			yield* writeSession(fs, path, projectDir, "session-a.jsonl", [
				{ type: "user", sessionId: "session-a", message: { role: "user", content: "hi" } }
			])
			const before = yield* projectDirectorySignature(fs, path, projectsRoot, projectPath)
			yield* writeSession(fs, path, projectDir, "session-b.jsonl", [
				{ type: "user", sessionId: "session-b", message: { role: "user", content: "hi again" } }
			])
			const after = yield* projectDirectorySignature(fs, path, projectsRoot, projectPath)
			Vitest.assert.notStrictEqual(before, after)
		}))
})
