import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

export const OpenCodeModel = Schema.Struct({
	providerId: Schema.String.check(Schema.isNonEmpty()),
	modelId: Schema.String.check(Schema.isNonEmpty())
})
export type OpenCodeModel = typeof OpenCodeModel.Type

export const OpenCodeSessionRecord = Schema.Struct({
	id: Schema.String.check(Schema.isNonEmpty()),
	directory: Schema.String.check(Schema.isNonEmpty()),
	projectID: Schema.String.check(Schema.isNonEmpty()),
	title: Schema.optionalKey(Schema.String)
})
export type OpenCodeSessionRecord = typeof OpenCodeSessionRecord.Type

export type SseLineFold = {
	readonly pending: ReadonlyArray<string>
}

export const emptySseLineFold: SseLineFold = {
	pending: Arr.empty()
}

export type OpenCodeUrls = {
	readonly baseUrl: string
	readonly session: string
	readonly config: string
	readonly provider: string
	readonly command: string
	readonly globalEvent: string
	readonly promptAsync: (sessionId: string) => string
	readonly abort: (sessionId: string) => string
	readonly permissionReply: (requestId: string) => string
	readonly questionReply: (requestId: string) => string
}

export type OpenCodePromptBody = {
	readonly directory: string
	readonly model: {
		readonly providerID: string
		readonly modelID: string
	}
	readonly agent: string
	readonly parts: ReadonlyArray<{
		readonly type: "text"
		readonly text: string
	}>
}

export const parseModelSelection = (modelId: string): Option.Option<OpenCodeModel> => {
	const trimmed = Str.trim(modelId)
	const slash = trimmed.indexOf("/")
	if (slash <= 0 || slash === trimmed.length - 1) {
		return Option.none()
	}
	const providerId = Str.trim(trimmed.slice(0, slash))
	const id = Str.trim(trimmed.slice(slash + 1))
	if (Str.isEmpty(providerId) || Str.isEmpty(id)) {
		return Option.none()
	}
	return Option.some({
		providerId,
		modelId: id
	})
}

export const canonicalModelId = (model: OpenCodeModel): string =>
	`${model.providerId}/${model.modelId}`

export const isSafeRequestId = (requestId: string): boolean => {
	if (Str.isEmpty(requestId)) {
		return false
	}
	return /^[A-Za-z0-9_-]+$/.test(requestId)
}

export const openCodeUrls = (baseUrl: string): OpenCodeUrls => {
	const trimmed = Str.replace(/\/$/, "")(baseUrl)
	return {
		baseUrl: trimmed,
		session: `${trimmed}/session`,
		config: `${trimmed}/config`,
		provider: `${trimmed}/provider`,
		command: `${trimmed}/command`,
		globalEvent: `${trimmed}/global/event`,
		promptAsync: (sessionId) => `${trimmed}/session/${sessionId}/prompt_async`,
		abort: (sessionId) => `${trimmed}/session/${sessionId}/abort`,
		permissionReply: (requestId) => `${trimmed}/permission/${requestId}/reply`,
		questionReply: (requestId) => `${trimmed}/question/${requestId}/reply`
	}
}

export const buildPromptBody = (input: {
	readonly directory: string
	readonly model: OpenCodeModel
	readonly agent: string
	readonly text: string
}): OpenCodePromptBody => ({
	directory: input.directory,
	model: {
		providerID: input.model.providerId,
		modelID: input.model.modelId
	},
	agent: input.agent,
	parts: [
		{
			type: "text",
			text: input.text
		}
	]
})

export const resolveConfiguredModel = (
	configuredModelId: string,
	availableModelIds: ReadonlyArray<string>
): Option.Option<string> => {
	if (Arr.contains(availableModelIds, configuredModelId)) {
		return Option.some(configuredModelId)
	}
	if (Str.includes("/")(configuredModelId)) {
		return Option.none()
	}
	const matches = Arr.filter(availableModelIds, (modelId) => {
		const slash = modelId.lastIndexOf("/")
		if (slash < 0) {
			return false
		}
		return modelId.slice(slash + 1) === configuredModelId
	})
	if (matches.length === 1) {
		return Arr.head(matches)
	}
	return Option.none()
}

export const consumeSseLine = (
	fold: SseLineFold,
	line: string
): {
	readonly fold: SseLineFold
	readonly raw: Option.Option<string>
} => {
	const trimmed = Str.replace(/\r$/, "")(line)
	if (Str.isEmpty(trimmed)) {
		if (fold.pending.length === 0) {
			return {
				fold: emptySseLineFold,
				raw: Option.none()
			}
		}
		return {
			fold: emptySseLineFold,
			raw: Option.some(Arr.join(fold.pending, "\n"))
		}
	}
	if (Str.startsWith("data:")(trimmed)) {
		return {
			fold: {
				pending: Arr.append(fold.pending, Str.trimStart(trimmed.slice(5)))
			},
			raw: Option.none()
		}
	}
	return {
		fold,
		raw: Option.none()
	}
}
