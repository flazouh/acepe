import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import {
	decodeRequestLine,
	encodeFailureLine,
	encodeSuccessLine,
	JsonRpcFailure,
	JsonRpcFailureLine,
	JsonRpcRequest,
	JsonRpcSuccess,
	JsonRpcSuccessLine,
} from "./jsonrpc.ts"

describe("jsonrpc", () => {
	it.effect("decodes a newline-delimited request", () =>
		Effect.gen(function* () {
			const request = yield* decodeRequestLine(
				'{"jsonrpc":"2.0","id":1,"method":"acp_initialize","params":{"ok":true}}',
			)
			expect(request.jsonrpc).toBe("2.0")
			expect(request.method).toBe("acp_initialize")
			expect(request.id).toBe(1)
			const params = yield* Schema.decodeUnknownEffect(
				Schema.Struct({ ok: Schema.Boolean }),
			)(request.params)
			expect(params.ok).toBe(true)
		}),
	)

	it.effect("encodes a success response without a trailing newline", () =>
		Effect.gen(function* () {
			const response = yield* Schema.decodeUnknownEffect(JsonRpcSuccess)({
				jsonrpc: "2.0",
				id: "req-1",
				result: { ok: true },
			})
			const line = yield* encodeSuccessLine(response)
			expect(line.includes("\n")).toBe(false)
			const decoded = yield* Schema.decodeUnknownEffect(JsonRpcSuccessLine)(line)
			expect(decoded.id).toBe("req-1")
			const result = yield* Schema.decodeUnknownEffect(
				Schema.Struct({ ok: Schema.Boolean }),
			)(decoded.result)
			expect(result.ok).toBe(true)
		}),
	)

	it.effect("encodes a parse failure with a null id", () =>
		Effect.gen(function* () {
			const response = yield* Schema.decodeUnknownEffect(JsonRpcFailure)({
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32700,
					message: "Parse error",
				},
			})
			const line = yield* encodeFailureLine(response)
			const decoded = yield* Schema.decodeUnknownEffect(JsonRpcFailureLine)(line)
			expect(decoded.id).toBeNull()
			expect(decoded.error.code).toBe(-32700)
		}),
	)

	it.effect("rejects a request that is missing jsonrpc", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Schema.decodeUnknownEffect(JsonRpcRequest)({
					id: 1,
					method: "acp_initialize",
				}),
			)
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)
})
