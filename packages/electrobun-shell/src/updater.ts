import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const defaultReleaseBaseUrl = "https://github.com/flazouh/acepe/releases/latest/download"

export const localDemoBaseUrl = "http://127.0.0.1:41799/"

export const nextCalver = (version: string): string => {
	const parts = version.split(".")
	const major = parts[0]
	const minor = parts[1]
	const patch = parts[2]
	if (major === undefined || minor === undefined || patch === undefined) {
		return version
	}
	const patchNumber = Number(patch)
	if (Number.isNaN(patchNumber)) {
		return version
	}
	return `${major}.${minor}.${String(patchNumber + 1)}`
}

export type UpdateDemoPlan = {
	readonly fromVersion: string
	readonly toVersion: string
	readonly generatePatch: boolean
	readonly secondBuildBaseUrl: string
}

export const demoUpdatePlan = (fromVersion: string): UpdateDemoPlan => ({
	fromVersion,
	toVersion: nextCalver(fromVersion),
	generatePatch: true,
	secondBuildBaseUrl: localDemoBaseUrl,
})

export const selectPatchArtifact = (files: ReadonlyArray<string>): string | undefined =>
	files.find((file) => file.endsWith(".patch"))

export class PatchMissingError extends Schema.TaggedError<PatchMissingError>()("PatchMissingError", {
	fromVersion: Schema.String,
	toVersion: Schema.String,
}) {}

export type PatchArtifacts = {
	readonly fromVersion: string
	readonly toVersion: string
	readonly patchFile: string
}

export const patchArtifactsFrom = Effect.fn("patchArtifactsFrom")(function* (input: {
	readonly fromVersion: string
	readonly toVersion: string
	readonly files: ReadonlyArray<string>
}) {
	const patchFile = selectPatchArtifact(input.files)
	if (patchFile === undefined) {
		return yield* new PatchMissingError({
			fromVersion: input.fromVersion,
			toVersion: input.toVersion,
		})
	}
	return {
		fromVersion: input.fromVersion,
		toVersion: input.toVersion,
		patchFile,
	}
})
