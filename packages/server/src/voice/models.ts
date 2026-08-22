import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Str from "effect/String"
import { VoiceUnknownBackendError } from "./Errors.ts"
import {
	EXTERNAL_BACKEND_ID,
	EXTERNAL_BACKEND_NAME,
	EXTERNAL_BACKEND_SENTINEL_PATH,
	type VoiceLanguageOption,
	type VoiceModelInfo
} from "./Schemas.ts"
import { titleCaseLanguageName } from "./audio.ts"

export const validateModelId = (
	modelId: string
): Result.Result<string, VoiceUnknownBackendError> => {
	if (Str.trim(modelId).length === 0) {
		return Result.fail(new VoiceUnknownBackendError({}))
	}
	return Result.succeed(modelId)
}

export const modelPathFor = (modelId: string): Option.Option<string> => {
	if (Str.trim(modelId).length === 0) {
		return Option.none()
	}
	return Option.some(EXTERNAL_BACKEND_SENTINEL_PATH)
}

export const makeExternalModelInfo = (isDownloaded: boolean, isLoaded: boolean): VoiceModelInfo => ({
	id: EXTERNAL_BACKEND_ID,
	name: EXTERNAL_BACKEND_NAME,
	sizeBytes: 0,
	isEnglishOnly: false,
	isDownloaded,
	isLoaded,
	downloadUrl: ""
})

export const listVoiceLanguages = (): ReadonlyArray<VoiceLanguageOption> => [
	{ code: "auto", name: "Auto" },
	{ code: "en", name: titleCaseLanguageName("english") }
]
