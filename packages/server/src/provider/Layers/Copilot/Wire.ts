import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { field, type Json, type JsonObject, jsonObjectOf, stringField } from "../Json.ts"
import { mapOutboundCopilotModeId, normalizeCopilotModeId } from "./Provider.ts"

export const COPILOT_ACP_PROTOCOL_VERSION = PROTOCOL_VERSION

export const COPILOT_LOGIN_METHOD_ID = "copilot-login"

export const COPILOT_SESSION_MCP_SERVERS: ReadonlyArray<never> = Arr.empty()

export const INITIALIZE_METHOD = "initialize"
export const SESSION_NEW_METHOD = "session/new"
export const SESSION_PROMPT_METHOD = "session/prompt"
export const SESSION_SET_MODE_METHOD = "session/set_mode"
export const SESSION_CANCEL_METHOD = "session/cancel"
export const SESSION_REQUEST_PERMISSION_METHOD = "session/request_permission"
export const SESSION_UPDATE_METHOD = "session/update"

// ACP's opening handshake. Copilot rejects a session/new that arrives before
// it, so this is the first thing openSession sends. The fs capabilities are
// off because Acepe answers no fs request for Copilot yet: claiming one the
// client cannot serve hangs the agent on a request nothing replies to.
export const copilotInitializeParams = (): JsonObject => ({
	protocolVersion: COPILOT_ACP_PROTOCOL_VERSION,
	clientCapabilities: {
		fs: {
			readTextFile: false,
			writeTextFile: false
		}
	},
	clientInfo: {
		name: "acepe",
		version: "0.0.1"
	}
})

export const copilotSessionNewParams = (
	cwd: string
): { readonly cwd: string; readonly mcpServers: ReadonlyArray<never> } => ({
	cwd,
	mcpServers: COPILOT_SESSION_MCP_SERVERS
})

export const copilotAuthenticateParams = {
	methodId: COPILOT_LOGIN_METHOD_ID
} as const

// ACP session/set_mode params. Copilot speaks the mode-URI form of a mode id,
// which mapOutboundCopilotModeId already knew how to produce -- nothing
// called it until issue #272 gave the mode a route to the adapter.
export const copilotSetModeParams = (
	providerSessionId: string,
	modeId: string
): { readonly sessionId: string; readonly modeId: string } => ({
	sessionId: providerSessionId,
	modeId: mapOutboundCopilotModeId(normalizeCopilotModeId(modeId))
})

export const copilotPromptParams = (providerSessionId: string, text: string): JsonObject => ({
	sessionId: providerSessionId,
	prompt: [
		{
			type: "text",
			text
		}
	]
})

export const copilotCancelParams = (providerSessionId: string): JsonObject => ({
	sessionId: providerSessionId
})

export const copilotSessionNewResultId = (result: Json): Option.Option<string> =>
	Option.flatMap(jsonObjectOf(result), (record) => stringField(record, "sessionId"))

// The id a reply must carry back, in the JSON type it arrived in: JSON-RPC 2.0
// §4.1 allows a string or a number and requires the response id to equal the
// request id. Mirrors Codex/Wire.ts's accessor of the same name, because both
// providers answer agent-initiated requests over a raw JSON-RPC line.
export const jsonRpcRequestId = (raw: Json): Option.Option<Json> =>
	Option.flatMap(jsonObjectOf(raw), (record) =>
		Option.flatMap(field(record, "id"), (id) =>
			Predicate.isString(id) || Predicate.isNumber(id) ? Option.some(id) : Option.none()
		)
	)

export const jsonRpcMethod = (raw: Json): Option.Option<string> =>
	Option.flatMap(jsonObjectOf(raw), (record) => stringField(record, "method"))

export const jsonRpcParams = (raw: Json): Option.Option<JsonObject> =>
	Option.flatMap(jsonObjectOf(raw), (record) =>
		Option.flatMap(field(record, "params"), jsonObjectOf)
	)
