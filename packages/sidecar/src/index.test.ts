import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { decodeRequestLine, sidecarNotification } from "./index.ts"

describe("index", () => {
	it.effect("re-exports the stdio request decoder", () =>
		Effect.gen(function* () {
			const request = yield* decodeRequestLine(
				'{"jsonrpc":"2.0","id":"a","method":"acp_list_agents"}',
			)
			expect(request.method).toBe("acp_list_agents")
		}),
	)

	it.effect("re-exports session-tagged notification construction", () =>
		Effect.gen(function* () {
			const notification = yield* sidecarNotification({
				method: "acp-session-state",
				sessionId: "session-2",
				payload: { revision: 1 },
				seq: 3,
			})
			expect(notification.method).toBe("acp-session-state")
			expect(notification.params.sessionId).toBe("session-2")
		}),
	)
})
