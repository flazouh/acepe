import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export class SidecarNotificationParams extends Schema.Class<SidecarNotificationParams>(
	"SidecarNotificationParams",
)({
	sessionId: Schema.NullOr(Schema.String),
	seq: Schema.optionalKey(Schema.Number),
	payload: Schema.Unknown,
}) {}

export class SidecarNotification extends Schema.Class<SidecarNotification>("SidecarNotification")({
	jsonrpc: Schema.Literal("2.0"),
	method: Schema.String,
	params: SidecarNotificationParams,
}) {}

export const SidecarNotificationLine = Schema.fromJsonString(SidecarNotification)

export interface SidecarNotificationInput {
	readonly method: string
	readonly sessionId: string | null
	readonly payload: unknown
	readonly seq: number | undefined
}

function notificationFields(input: SidecarNotificationInput): unknown {
	if (input.seq === undefined) {
		return {
			jsonrpc: "2.0",
			method: input.method,
			params: {
				sessionId: input.sessionId,
				payload: input.payload,
			},
		}
	}
	return {
		jsonrpc: "2.0",
		method: input.method,
		params: {
			sessionId: input.sessionId,
			seq: input.seq,
			payload: input.payload,
		},
	}
}

export const sidecarNotification = Effect.fn("sidecarNotification")(
	(input: SidecarNotificationInput) =>
		Schema.decodeUnknownEffect(SidecarNotification)(notificationFields(input)),
)

export const encodeNotificationLine = Effect.fn("encodeNotificationLine")(
	(notification: SidecarNotification) =>
		Schema.encodeUnknownEffect(SidecarNotificationLine)(notification),
)
