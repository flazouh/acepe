import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const JsonRpcVersion = Schema.Literal("2.0")

export const JsonRpcId = Schema.Union([Schema.String, Schema.Number])

export class JsonRpcErrorObject extends Schema.Class<JsonRpcErrorObject>("JsonRpcErrorObject")({
	code: Schema.Int,
	message: Schema.String,
	data: Schema.optionalKey(Schema.Unknown),
}) {}

export class JsonRpcRequest extends Schema.Class<JsonRpcRequest>("JsonRpcRequest")({
	jsonrpc: JsonRpcVersion,
	id: JsonRpcId,
	method: Schema.String,
	params: Schema.optionalKey(Schema.Unknown),
}) {}

export class JsonRpcSuccess extends Schema.Class<JsonRpcSuccess>("JsonRpcSuccess")({
	jsonrpc: JsonRpcVersion,
	id: JsonRpcId,
	result: Schema.Unknown,
}) {}

export class JsonRpcFailure extends Schema.Class<JsonRpcFailure>("JsonRpcFailure")({
	jsonrpc: JsonRpcVersion,
	id: Schema.NullOr(JsonRpcId),
	error: JsonRpcErrorObject,
}) {}

export const JsonRpcRequestLine = Schema.fromJsonString(JsonRpcRequest)
export const JsonRpcSuccessLine = Schema.fromJsonString(JsonRpcSuccess)
export const JsonRpcFailureLine = Schema.fromJsonString(JsonRpcFailure)

export const decodeRequestLine = Effect.fn("decodeRequestLine")((line: string) =>
	Schema.decodeUnknownEffect(JsonRpcRequestLine)(line),
)

export const encodeSuccessLine = Effect.fn("encodeSuccessLine")((response: JsonRpcSuccess) =>
	Schema.encodeUnknownEffect(JsonRpcSuccessLine)(response),
)

export const encodeFailureLine = Effect.fn("encodeFailureLine")((response: JsonRpcFailure) =>
	Schema.encodeUnknownEffect(JsonRpcFailureLine)(response),
)
