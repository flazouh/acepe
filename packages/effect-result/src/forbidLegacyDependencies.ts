import * as Arr from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

export const FORBIDDEN_LEGACY_PACKAGES = ["neverthrow", "zod"] as const
export type ForbiddenLegacyPackage = (typeof FORBIDDEN_LEGACY_PACKAGES)[number]

export type LegacyDependencyField =
	| "dependencies"
	| "devDependencies"
	| "peerDependencies"
	| "optionalDependencies"
	| "catalog"

export type LegacyDependencyViolation = {
	readonly packageJsonPath: string
	readonly field: LegacyDependencyField
	readonly dependency: ForbiddenLegacyPackage
}

export class PackageManifestInvalid extends Data.TaggedError("PackageManifestInvalid")<{
	readonly packageJsonPath: string
	readonly reason: string
}> {}

export class ForbiddenLegacyDependencies extends Data.TaggedError("ForbiddenLegacyDependencies")<{
	readonly violations: ReadonlyArray<LegacyDependencyViolation>
}> {}

const GLOB_EXCLUDE = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/build/**",
	"**/.svelte-kit/**",
	"**/coverage/**"
] as const

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
	"catalog"
] as const satisfies ReadonlyArray<LegacyDependencyField>

const PackageManifest = Schema.Struct({
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	catalog: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
})

type PackageManifest = typeof PackageManifest.Type

const PackageManifestJson = Schema.fromJsonString(PackageManifest)

const listPackageJsonFiles = (
	root: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const relativePaths = yield* fs.glob("**/package.json", {
			root,
			exclude: GLOB_EXCLUDE
		})
		return relativePaths.map((relativePath) => path.join(root, relativePath))
	})

const violationsInField = (
	packageJsonPath: string,
	field: LegacyDependencyField,
	deps: Readonly<Record<string, string>> | undefined
): ReadonlyArray<LegacyDependencyViolation> => {
	if (deps === undefined) {
		return []
	}
	return Arr.filterMap(FORBIDDEN_LEGACY_PACKAGES, (dependency) => {
		if (Object.hasOwn(deps, dependency)) {
			return Result.succeed({
				packageJsonPath,
				field,
				dependency
			})
		}
		return Result.failVoid
	})
}

const violationsInManifest = (
	packageJsonPath: string,
	manifest: PackageManifest
): ReadonlyArray<LegacyDependencyViolation> =>
	Arr.flatMap(DEPENDENCY_FIELDS, (field) =>
		violationsInField(packageJsonPath, field, manifest[field])
	)

const violationsInPackageJson = (
	packageJsonPath: string
): Effect.Effect<
	ReadonlyArray<LegacyDependencyViolation>,
	PackageManifestInvalid | PlatformError,
	FileSystem.FileSystem
> =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const content = yield* fs.readFileString(packageJsonPath)
		const manifest = yield* Schema.decodeUnknownEffect(PackageManifestJson)(content).pipe(
			Effect.mapError(
				(error) =>
					new PackageManifestInvalid({
						packageJsonPath,
						reason: error.message
					})
			)
		)
		return violationsInManifest(packageJsonPath, manifest)
	})

export const checkForbiddenLegacyDependencies = (
	root: string
): Effect.Effect<
	void,
	ForbiddenLegacyDependencies | PackageManifestInvalid | PlatformError,
	FileSystem.FileSystem | Path.Path
> =>
	Effect.gen(function*() {
		const paths = yield* listPackageJsonFiles(root)
		const groups = yield* Effect.forEach(paths, violationsInPackageJson)
		const violations = Arr.flatten(groups)
		if (violations.length > 0) {
			return yield* new ForbiddenLegacyDependencies({ violations })
		}
	})
