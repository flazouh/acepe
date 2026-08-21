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

export const RPC_ROUNDTRIP_PREFIX = "acepe-shell-rpc-roundtrip"

export const RPC_ROUNDTRIP_MESSAGE = "desktop round trip"

export const WINDOW_OPENED_PREFIX = "acepe-shell-window-opened"

export const SHELL_PROOF_LOG_PATH = "/tmp/acepe-shell-proof.log"

export const formatRpcRoundtripLine = (echo: string): string => `${RPC_ROUNDTRIP_PREFIX}: ${echo}`

export const formatWindowOpenedLine = (title: string): string => `${WINDOW_OPENED_PREFIX}: ${title}`
