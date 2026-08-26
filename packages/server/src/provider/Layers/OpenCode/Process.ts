import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import type { Json, JsonObject } from "../Json.ts"
import type { OpenCodePermissionReply } from "./Facts.ts"
import { adapterError, parseServeUrl } from "./Provider.ts"
import {
	consumeSseLine,
	emptySseLineFold,
	type OpenCodePromptBody,
	type OpenCodeSessionRecord,
	OpenCodeSessionRecord as OpenCodeSessionRecordSchema,
	openCodeUrls,
	resolveConfiguredModel
} from "./Wire.ts"

export type OpenCodeCatalogModel = {
	readonly modelId: string
	readonly name: string
}

export type OpenCodeCatalogCommand = {
	readonly name: string
	readonly description: string
}

export type OpenCodeModelCatalog = {
	readonly models: ReadonlyArray<OpenCodeCatalogModel>
	readonly currentModelId: Option.Option<string>
}

export type OpenCodeTransport = {
	readonly events: Stream.Stream<Json, ProviderAdapterError>
	readonly createSession: Effect.Effect<OpenCodeSessionRecord, ProviderAdapterError>
	readonly listModels: Effect.Effect<OpenCodeModelCatalog, ProviderAdapterError>
	readonly listCommands: Effect.Effect<ReadonlyArray<OpenCodeCatalogCommand>, ProviderAdapterError>
	readonly sendPrompt: (
		providerSessionId: string,
		body: OpenCodePromptBody
	) => Effect.Effect<void, ProviderAdapterError>
	readonly abort: (providerSessionId: string) => Effect.Effect<void, ProviderAdapterError>
	readonly replyPermission: (
		requestId: string,
		reply: OpenCodePermissionReply
	) => Effect.Effect<void, ProviderAdapterError>
	readonly replyQuestion: (
		requestId: string,
		answers: ReadonlyArray<ReadonlyArray<string>>
	) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

const READY_TIMEOUT = Duration.millis(15_000)
const READY_INTERVAL = Duration.millis(200)
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

const OpenCodeProviderModel = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	name: Schema.String,
	capabilities: Schema.optionalKey(
		Schema.Struct({
			toolcall: Schema.optionalKey(Schema.Boolean)
		})
	)
})

const OpenCodeProviderEntry = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	models: Schema.Record(Schema.String, OpenCodeProviderModel)
})

const OpenCodeProviderResponse = Schema.Struct({
	connected: Schema.Array(Schema.String),
	all: Schema.Array(OpenCodeProviderEntry)
})

const OpenCodeConfigResponse = Schema.Struct({
	model: Schema.optionalKey(Schema.String)
})

const OpenCodeCommandResponse = Schema.Array(
	Schema.Struct({
		name: Schema.String,
		description: Schema.optionalKey(Schema.String)
	})
)

const decodeProviderResponse = Schema.decodeUnknownEffect(OpenCodeProviderResponse)
const decodeConfigResponse = Schema.decodeUnknownEffect(OpenCodeConfigResponse)
const decodeCommandResponse = Schema.decodeUnknownEffect(OpenCodeCommandResponse)

const COMPACT_COMMAND: OpenCodeCatalogCommand = {
	name: "compact",
	description: "compact the session"
}

const httpError = (
	operation: ProviderAdapterError["operation"],
	cause: { readonly message?: string },
	fallback: string
): ProviderAdapterError => {
	if (cause.message !== undefined && Str.isNonEmpty(cause.message)) {
		return adapterError(operation, cause.message)
	}
	return adapterError(operation, fallback)
}

const supportsToolCalls = (model: typeof OpenCodeProviderModel.Type): boolean => {
	if (model.capabilities === undefined || model.capabilities.toolcall === undefined) {
		return true
	}
	return model.capabilities.toolcall
}

const flattenProviderModels = (
	response: typeof OpenCodeProviderResponse.Type
): ReadonlyArray<OpenCodeCatalogModel> => {
	const connected = HashMap.fromIterable(Arr.map(response.connected, (id) => [id, true] as const))
	return Arr.flatMap(response.all, (provider) => {
		if (HashMap.has(connected, provider.id) === false) {
			return Arr.empty<OpenCodeCatalogModel>()
		}
		return Rec.reduce(
			provider.models,
			Arr.empty<OpenCodeCatalogModel>(),
			(acc, model, modelKey) => {
				if (supportsToolCalls(model) === false) {
					return acc
				}
				return Arr.append(acc, {
					modelId: `${provider.id}/${modelKey}`,
					name: model.name
				})
			}
		)
	})
}

const promptJson = (body: OpenCodePromptBody): JsonObject => ({
	directory: body.directory,
	model: {
		providerID: body.model.providerID,
		modelID: body.model.modelID
	},
	agent: body.agent,
	parts: Arr.map(body.parts, (part) => ({
		type: part.type,
		text: part.text
	}))
})

export const liveCreateTransport = Effect.fn("liveCreateTransport")(function*(input: {
	readonly workspaceRoot: string
	readonly command: string
	readonly args: ReadonlyArray<string>
	readonly env: Readonly<Record<string, string>>
	readonly http: HttpClient.HttpClient
	readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
}) {
	const scope = yield* Scope.make()
	const child = yield* input.spawner
		.spawn(
			ChildProcess.make(input.command, input.args, {
				cwd: input.workspaceRoot,
				env: input.env,
				extendEnv: false,
				detached: false
			})
		)
		.pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.mapError((cause) =>
				httpError("startSession", cause, "Failed to start OpenCode")
			)
		)
	const serveUrl = yield* child.stdout.pipe(
		Stream.decodeText,
		Stream.splitLines,
		Stream.filterMap(Filter.fromPredicateOption(parseServeUrl)),
		Stream.take(1),
		Stream.runHead,
		Effect.timeout(READY_TIMEOUT),
		Effect.mapError((cause) =>
			httpError("startSession", cause, "Failed to get port after starting")
		)
	)
	if (Option.isNone(serveUrl)) {
		yield* child.kill().pipe(Effect.ignore)
		yield* Scope.close(scope, Exit.succeed(undefined)).pipe(Effect.ignore)
		return yield* adapterError("startSession", "Failed to get port after starting")
	}
	const urls = openCodeUrls(
		`http://127.0.0.1:${String(serveUrl.value.port)}${serveUrl.value.apiPrefix}`
	)
	const http = input.http.pipe(HttpClient.filterStatusOk)
	yield* http.get(urls.config).pipe(
		Effect.asVoid,
		Effect.retry(Schedule.spaced(READY_INTERVAL)),
		Effect.timeout(READY_TIMEOUT),
		Effect.mapError((cause) =>
			httpError(
				"startSession",
				cause,
				`OpenCode not ready after ${String(Duration.toMillis(READY_TIMEOUT))}ms`
			)
		)
	)
	const postJson = Effect.fn("OpenCodeAdapter.postJson")(function*(
		operation: ProviderAdapterError["operation"],
		url: string,
		body: Json
	) {
		const encoded = yield* HttpBody.json(body).pipe(
			Effect.mapError((cause) =>
				httpError(operation, cause, "OpenCode request body was not JSON")
			)
		)
		return yield* http.post(url, { body: encoded }).pipe(
			Effect.mapError((cause) => httpError(operation, cause, "OpenCode HTTP request failed"))
		)
	})
	const events = HttpClientResponse.stream(
		http.get(urls.globalEvent, {
			accept: "text/event-stream",
			headers: {
				"accept-encoding": "identity"
			}
		})
	).pipe(
		Stream.decodeText,
		Stream.splitLines,
		Stream.mapAccum(() => emptySseLineFold, (fold, line) => {
			const consumed = consumeSseLine(fold, line)
			return [
				consumed.fold,
				Option.match(consumed.raw, {
					onNone: () => Arr.empty<string>(),
					onSome: (text) => Arr.of(text)
				})
			]
		}),
		Stream.mapError((cause) =>
			httpError("startSession", cause, "OpenCode SSE stream failed")
		),
		Stream.mapEffect((text) =>
			decodeJson(text).pipe(
				Effect.mapError(() => adapterError("startSession", "OpenCode SSE event was not JSON"))
			)
		)
	)
	const createSession = Effect.gen(function*() {
		const response = yield* postJson("startSession", urls.session, {
			directory: input.workspaceRoot
		})
		return yield* HttpClientResponse.schemaBodyJson(OpenCodeSessionRecordSchema)(response).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode session response was invalid")
			)
		)
	})
	const listModels = Effect.gen(function*() {
		const response = yield* http.get(urls.provider).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode provider catalog failed")
			)
		)
		const jsonBody = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode provider catalog was not JSON")
			)
		)
		const decoded = yield* decodeProviderResponse(jsonBody).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode provider catalog was invalid")
			)
		)
		const models = flattenProviderModels(decoded)
		const configResponse = yield* http.get(urls.config).pipe(
			Effect.flatMap((ok) => HttpClientResponse.schemaBodyJson(Schema.Json)(ok)),
			Effect.flatMap(decodeConfigResponse),
			Effect.option
		)
		const configured = Option.flatMap(configResponse, (config) =>
			config.model === undefined || Str.isEmpty(Str.trim(config.model))
				? Option.none<string>()
				: Option.some(config.model)
		)
		const currentModelId = Option.flatMap(configured, (modelId) =>
			resolveConfiguredModel(
				modelId,
				Arr.map(models, (model) => model.modelId)
			)
		)
		return {
			models,
			currentModelId
		}
	})
	const listCommands = Effect.gen(function*() {
		const response = yield* http
			.get(urls.command, {
				urlParams: [["directory", input.workspaceRoot]]
			})
			.pipe(Effect.option)
		if (Option.isNone(response)) {
			return [COMPACT_COMMAND]
		}
		const jsonBody = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response.value).pipe(
			Effect.option
		)
		if (Option.isNone(jsonBody)) {
			return [COMPACT_COMMAND]
		}
		const decoded = yield* decodeCommandResponse(jsonBody.value).pipe(Effect.option)
		if (Option.isNone(decoded)) {
			return [COMPACT_COMMAND]
		}
		return Arr.map(decoded.value, (command) => ({
			name: command.name,
			description: command.description === undefined ? "" : command.description
		}))
	})
	return {
		events,
		createSession,
		listModels,
		listCommands,
		sendPrompt: (providerSessionId, body) =>
			postJson("sendPrompt", urls.promptAsync(providerSessionId), promptJson(body)).pipe(
				Effect.asVoid
			),
		abort: (providerSessionId) =>
			postJson("cancelTurn", urls.abort(providerSessionId), {
				directory: input.workspaceRoot
			}).pipe(Effect.asVoid),
		replyPermission: (requestId, reply) =>
			postJson("sendPrompt", urls.permissionReply(requestId), { reply }).pipe(Effect.asVoid),
		replyQuestion: (requestId, answers) =>
			postJson("sendPrompt", urls.questionReply(requestId), { answers }).pipe(Effect.asVoid),
		close: child.kill().pipe(
			Effect.flatMap(() => Scope.close(scope, Exit.succeed(undefined))),
			Effect.ignore
		)
	} satisfies OpenCodeTransport
})
