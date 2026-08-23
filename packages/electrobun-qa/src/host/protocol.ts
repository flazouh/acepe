import * as Schema from "effect/Schema"

export const QA_PRELOAD_METHODS = [
	"qa:eval",
	"qa:snapshotText",
	"qa:snapshotDom",
	"qa:click",
	"qa:type",
	"qa:key",
	"qa:scroll",
	"qa:waitFor",
	"qa:pageInfo",
] as const

export const QaPreloadMethod = Schema.Literals(QA_PRELOAD_METHODS)
export type QaPreloadMethod = typeof QaPreloadMethod.Type

export const QaClickTarget = Schema.Struct({
	selector: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
})
export type QaClickTarget = typeof QaClickTarget.Type

export const QaTypePayload = Schema.Struct({
	text: Schema.String,
	selector: Schema.optionalKey(Schema.String),
	replace: Schema.optionalKey(Schema.Boolean),
})
export type QaTypePayload = typeof QaTypePayload.Type

export const QaKeyPayload = Schema.Struct({
	key: Schema.String,
})
export type QaKeyPayload = typeof QaKeyPayload.Type

export const QaScrollPayload = Schema.Struct({
	x: Schema.Number,
	y: Schema.Number,
})
export type QaScrollPayload = typeof QaScrollPayload.Type

export const QaWaitForPayload = Schema.Struct({
	selector: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
})
export type QaWaitForPayload = typeof QaWaitForPayload.Type

export const QaEvalPayload = Schema.Struct({
	source: Schema.String,
})
export type QaEvalPayload = typeof QaEvalPayload.Type

export class QaWindowInfo extends Schema.Class<QaWindowInfo>("QaWindowInfo")({
	id: Schema.String,
	title: Schema.String,
	url: Schema.String,
}) {}

export const QaWindowInfoList = Schema.Array(QaWindowInfo)

export class QaDoctorReport extends Schema.Class<QaDoctorReport>("QaDoctorReport")({
	title: Schema.String,
	url: Schema.String,
	windows: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class QaSocketRequest extends Schema.Class<QaSocketRequest>("QaSocketRequest")({
	id: Schema.String,
	method: Schema.String,
	params: Schema.optionalKey(Schema.Unknown),
}) {}

export class QaSocketOk extends Schema.Class<QaSocketOk>("QaSocketOk")({
	id: Schema.String,
	ok: Schema.Literal(true),
	value: Schema.Unknown,
}) {}

export class QaSocketErr extends Schema.Class<QaSocketErr>("QaSocketErr")({
	id: Schema.String,
	ok: Schema.Literal(false),
	error: Schema.Struct({
		_tag: Schema.String,
		message: Schema.String,
	}),
}) {}

export const QaSocketResponse = Schema.Union([QaSocketOk, QaSocketErr])
export type QaSocketResponse = typeof QaSocketResponse.Type

export const QaSocketRequestLine = Schema.fromJsonString(QaSocketRequest)
export const QaSocketOkLine = Schema.fromJsonString(QaSocketOk)
export const QaSocketErrLine = Schema.fromJsonString(QaSocketErr)
export const QaSocketResponseLine = Schema.fromJsonString(QaSocketResponse)

export const QaDispatchRequest = Schema.Struct({
	type: Schema.Literal("request"),
	method: Schema.String,
	id: Schema.String,
	params: Schema.Unknown,
})
export const QaDispatchRequestJson = Schema.fromJsonString(QaDispatchRequest)

export const QaBridgeResult = Schema.Struct({
	id: Schema.String,
	success: Schema.Boolean,
	payload: Schema.Unknown,
})

export const QaInternalMessage = Schema.Struct({
	type: Schema.String,
	id: Schema.String,
	payload: QaBridgeResult,
})
export const QaInternalMessageJson = Schema.fromJsonString(QaInternalMessage)
const QaStringArray = Schema.Array(Schema.String)
export const QaInternalBatchJson = Schema.fromJsonString(QaStringArray)

export const formatDoctorOk = (report: {
	readonly title: string
	readonly url: string
	readonly windows: number
}): string =>
	`doctor: ok\n- title: ${report.title}\n- url: ${report.url}\n- windows: ${String(report.windows)}`
