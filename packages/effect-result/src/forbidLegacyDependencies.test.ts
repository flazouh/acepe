import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Result from "effect/Result"

import { checkForbiddenLegacyDependencies } from "./forbidLegacyDependencies.ts"

const TestPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const withManifestTree = <A, EWrite, EUse>(
	writeTree: (
		fs: FileSystem.FileSystem,
		path: Path.Path,
		root: string
	) => Effect.Effect<void, EWrite, never>,
	useRoot: (root: string) => Effect.Effect<A, EUse, FileSystem.FileSystem | Path.Path>
) =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const root = yield* fs.makeTempDirectoryScoped()
		yield* writeTree(fs, path, root)
		return yield* useRoot(root)
	})

Vitest.layer(TestPlatform)("checkForbiddenLegacyDependencies", (it) => {
	it.effect("succeeds when no package.json lists neverthrow or zod", () =>
		withManifestTree(
			(fs, path, root) =>
				fs.writeFileString(
					path.join(root, "package.json"),
					'{"name":"ok","dependencies":{"effect":"catalog:"}}'
				),
			(root) => checkForbiddenLegacyDependencies(root)
		)
	)

	it.effect("fails when dependencies list neverthrow", () =>
		withManifestTree(
			(fs, path, root) =>
				fs.writeFileString(
					path.join(root, "package.json"),
					'{"dependencies":{"neverthrow":"8.2.0"}}'
				),
			(root) =>
				Effect.gen(function*() {
					const result = yield* Effect.result(checkForbiddenLegacyDependencies(root))
					Vitest.assert.isTrue(Result.isFailure(result))
					if (Result.isFailure(result)) {
						Vitest.assert.strictEqual(result.failure._tag, "ForbiddenLegacyDependencies")
						if (result.failure._tag === "ForbiddenLegacyDependencies") {
							Vitest.assert.strictEqual(result.failure.violations.length, 1)
							const violation = result.failure.violations[0]
							Vitest.assert.isDefined(violation)
							Vitest.assert.strictEqual(violation.field, "dependencies")
							Vitest.assert.strictEqual(violation.dependency, "neverthrow")
						}
					}
				})
		)
	)

	it.effect("fails when devDependencies list zod", () =>
		withManifestTree(
			(fs, path, root) =>
				fs.writeFileString(
					path.join(root, "package.json"),
					'{"devDependencies":{"zod":"4.2.1"}}'
				),
			(root) =>
				Effect.gen(function*() {
					const result = yield* Effect.result(checkForbiddenLegacyDependencies(root))
					Vitest.assert.isTrue(Result.isFailure(result))
					if (Result.isFailure(result)) {
						Vitest.assert.strictEqual(result.failure._tag, "ForbiddenLegacyDependencies")
						if (result.failure._tag === "ForbiddenLegacyDependencies") {
							Vitest.assert.strictEqual(result.failure.violations.length, 1)
							const violation = result.failure.violations[0]
							Vitest.assert.isDefined(violation)
							Vitest.assert.strictEqual(violation.field, "devDependencies")
							Vitest.assert.strictEqual(violation.dependency, "zod")
						}
					}
				})
		)
	)

	it.effect("fails when catalog pins neverthrow", () =>
		withManifestTree(
			(fs, path, root) =>
				fs.writeFileString(
					path.join(root, "package.json"),
					'{"catalog":{"neverthrow":"8.2.0"}}'
				),
			(root) =>
				Effect.gen(function*() {
					const result = yield* Effect.result(checkForbiddenLegacyDependencies(root))
					Vitest.assert.isTrue(Result.isFailure(result))
					if (Result.isFailure(result)) {
						Vitest.assert.strictEqual(result.failure._tag, "ForbiddenLegacyDependencies")
						if (result.failure._tag === "ForbiddenLegacyDependencies") {
							const violation = result.failure.violations[0]
							Vitest.assert.isDefined(violation)
							Vitest.assert.strictEqual(violation.field, "catalog")
							Vitest.assert.strictEqual(violation.dependency, "neverthrow")
						}
					}
				})
		)
	)

	it.effect("ignores neverthrow inside node_modules", () =>
		withManifestTree(
			(fs, path, root) =>
				Effect.gen(function*() {
					yield* fs.makeDirectory(path.join(root, "node_modules", "other"), {
						recursive: true
					})
					yield* fs.writeFileString(
						path.join(root, "package.json"),
						'{"dependencies":{"effect":"catalog:"}}'
					)
					yield* fs.writeFileString(
						path.join(root, "node_modules", "other", "package.json"),
						'{"dependencies":{"neverthrow":"8.2.0","zod":"4.2.1"}}'
					)
				}),
			(root) => checkForbiddenLegacyDependencies(root)
		)
	)

	it.effect("scans nested workspace package.json files", () =>
		withManifestTree(
			(fs, path, root) =>
				Effect.gen(function*() {
					yield* fs.makeDirectory(path.join(root, "packages", "ui"), { recursive: true })
					yield* fs.writeFileString(path.join(root, "package.json"), '{"private":true}')
					yield* fs.writeFileString(
						path.join(root, "packages", "ui", "package.json"),
						'{"peerDependencies":{"zod":"4.2.1"}}'
					)
				}),
			(root) =>
				Effect.gen(function*() {
					const result = yield* Effect.result(checkForbiddenLegacyDependencies(root))
					Vitest.assert.isTrue(Result.isFailure(result))
					if (Result.isFailure(result)) {
						Vitest.assert.strictEqual(result.failure._tag, "ForbiddenLegacyDependencies")
						if (result.failure._tag === "ForbiddenLegacyDependencies") {
							const violation = result.failure.violations[0]
							Vitest.assert.isDefined(violation)
							Vitest.assert.strictEqual(violation.field, "peerDependencies")
							Vitest.assert.strictEqual(violation.dependency, "zod")
						}
					}
				})
		)
	)

	it.effect("fails when a package.json is not valid JSON", () =>
		withManifestTree(
			(fs, path, root) => fs.writeFileString(path.join(root, "package.json"), "{"),
			(root) =>
				Effect.gen(function*() {
					const result = yield* Effect.result(checkForbiddenLegacyDependencies(root))
					Vitest.assert.isTrue(Result.isFailure(result))
					if (Result.isFailure(result)) {
						Vitest.assert.strictEqual(result.failure._tag, "PackageManifestInvalid")
					}
				})
		)
	)
})
