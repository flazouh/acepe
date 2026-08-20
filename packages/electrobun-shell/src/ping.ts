import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const PingRequest = Schema.Struct({
	message: Schema.String,
})

export type PingRequest = typeof PingRequest.Type

export const PingResponse = Schema.Struct({
	echo: Schema.String,
})

export type PingResponse = typeof PingResponse.Type

export const handlePing = Effect.fn("handlePing")(function* (input: unknown) {
	const request = yield* Schema.decodeUnknownEffect(PingRequest)(input)
	return { echo: request.message }
})

export const pingRequestHandler = (input: unknown): PingResponse => Effect.runSync(handlePing(input))
