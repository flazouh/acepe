import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { claudeHomeRoot, claudeProjectsRoot, pathToSlug, slugToPath } from "./Roots.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const homeLayer = (env: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromEnv({ env }))

Vitest.describe("pathToSlug/slugToPath", () => {
	Vitest.it("replaces both '/' and '.' with '-', matching text_utils.rs", () => {
		Vitest.assert.strictEqual(
			pathToSlug("/Users/example/.acepe/worktrees/foo"),
			"-Users-example--acepe-worktrees-foo"
		)
	})

	Vitest.it("round-trips a plain absolute path", () => {
		const slug = pathToSlug("/Users/example/project")
		Vitest.assert.strictEqual(slugToPath(slug), "/Users/example/project")
	})

	Vitest.it("is lossy for dotted segments, matching the existing Rust behavior", () => {
		const slug = pathToSlug("/Users/example/.acepe/worktrees/foo")
		Vitest.assert.strictEqual(slugToPath(slug), "/Users/example//acepe/worktrees/foo")
	})
})

Vitest.layer(Platform)("claude roots", (it) => {
	it.effect("defaults to HOME/.claude when CLAUDE_HOME is unset", () =>
		Effect.gen(function*() {
			const home = yield* claudeHomeRoot().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(homeLayer({ HOME: "/tmp/fake-home" }))
			)
			Vitest.assert.strictEqual(home, "/tmp/fake-home/.claude")
			const projects = yield* claudeProjectsRoot().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(homeLayer({ HOME: "/tmp/fake-home" }))
			)
			Vitest.assert.strictEqual(projects, "/tmp/fake-home/.claude/projects")
		}))

	it.effect("honors a CLAUDE_HOME override, matching the Rust QA knob", () =>
		Effect.gen(function*() {
			const projects = yield* claudeProjectsRoot().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(homeLayer({ HOME: "/tmp/fake-home", CLAUDE_HOME: "/tmp/qa-claude" }))
			)
			Vitest.assert.strictEqual(projects, "/tmp/qa-claude/projects")
		}))
})
