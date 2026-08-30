import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import {
	homeRelativeFileExists,
	pathDirectories,
	resolveExecutableOnPath,
	resolveOverridableExecutable
} from "./ExecutableProbe.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const envLayer = (env: Record<string, string>) =>
	ConfigProvider.layer(ConfigProvider.fromEnv({ env }))

Vitest.layer(Platform)("ExecutableProbe", (it) => {
	it.effect("drops empty PATH segments", () =>
		Effect.gen(function*() {
			const directories = yield* pathDirectories().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({ PATH: "/one::/two:" }))
			)
			Vitest.assert.deepStrictEqual(directories, ["/one", "/two"])
		})
	)

	it.effect("answers none when PATH is unset", () =>
		Effect.gen(function*() {
			const found = yield* resolveExecutableOnPath("anything").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({}))
			)
			Vitest.assert.strictEqual(Option.isNone(found), true)
		})
	)

	it.effect("finds the first PATH entry that holds the executable", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const empty = path.join(root, "empty")
			const bin = path.join(root, "bin")
			yield* fs.makeDirectory(empty, { recursive: true })
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.writeFileString(path.join(bin, "widget"), "stub")
			const found = yield* resolveExecutableOnPath("widget").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({ PATH: `${empty}:${bin}` }))
			)
			Vitest.assert.deepStrictEqual(found, Option.some(path.join(bin, "widget")))
		})
	)

	// The regression this whole lane is about, at its smallest: the same probe
	// value, read twice, must answer the filesystem as it is now.
	it.effect("re-reads PATH on every call rather than caching the answer", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			yield* fs.makeDirectory(bin, { recursive: true })
			const probe = resolveExecutableOnPath("widget").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({ PATH: bin }))
			)
			Vitest.assert.strictEqual(Option.isNone(yield* probe), true)
			yield* fs.writeFileString(path.join(bin, "widget"), "stub")
			Vitest.assert.deepStrictEqual(yield* probe, Option.some(path.join(bin, "widget")))
		})
	)

	it.effect("prefers an override that names a file that exists", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const custom = path.join(root, "custom-widget")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.writeFileString(path.join(bin, "widget"), "stub")
			yield* fs.writeFileString(custom, "stub")
			const found = yield* resolveOverridableExecutable("widget", "WIDGET_BIN").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({ PATH: bin, WIDGET_BIN: custom }))
			)
			Vitest.assert.deepStrictEqual(found, Option.some(custom))
		})
	)

	it.effect("falls back to PATH when the override names nothing", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.writeFileString(path.join(bin, "widget"), "stub")
			const found = yield* resolveOverridableExecutable("widget", "WIDGET_BIN").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({ PATH: bin, WIDGET_BIN: path.join(root, "gone") }))
			)
			Vitest.assert.deepStrictEqual(found, Option.some(path.join(bin, "widget")))
		})
	)

	it.effect("reads a home-relative credential file when it appears", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const home = yield* fs.makeTempDirectoryScoped()
			const probe = homeRelativeFileExists(".widget/auth.json").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({ HOME: home }))
			)
			Vitest.assert.strictEqual(yield* probe, false)
			yield* fs.makeDirectory(path.join(home, ".widget"), { recursive: true })
			yield* fs.writeFileString(path.join(home, ".widget", "auth.json"), "{}")
			Vitest.assert.strictEqual(yield* probe, true)
		})
	)

	it.effect("reports not authenticated when HOME is unset", () =>
		Effect.gen(function*() {
			const answer = yield* homeRelativeFileExists(".widget/auth.json").pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(envLayer({}))
			)
			Vitest.assert.strictEqual(answer, false)
		})
	)
})
