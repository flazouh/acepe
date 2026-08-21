import { qaPreloadScript } from "./preload/qa-preload.ts"

export type QaBuildFlag = {
	readonly signed: boolean
}

export type QaArtifacts = {
	readonly preload: string | null
	readonly host: boolean
}

export const qaSurfaceEnabled = (build: QaBuildFlag): boolean => build.signed === false

export const qaArtifactsForBuild = (build: QaBuildFlag): QaArtifacts => {
	if (qaSurfaceEnabled(build) === true) {
		return {
			preload: qaPreloadScript,
			host: true,
		}
	}
	return {
		preload: null,
		host: false,
	}
}
