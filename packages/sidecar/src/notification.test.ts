import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	encodeNotificationLine,
	sidecarNotification,
	SidecarNotificationLine,
} from "./notification.ts"

describe("notification", () => {
	it.effect("tags a session update with sessionId and seq", () =>
		Effect.gen(function* () {
			const notification = yield* sidecarNotification({
				method: "acp-session-update",
				sessionId: "session-9",
				payload: { type: "agentMessageChunk", text: "hi" },
				seq: 42,
			})
			expect(notification.method).toBe("acp-session-update")
			expect(notification.params.sessionId).toBe("session-9")
			expect(notification.params.seq).toBe(42)
			const line = yield* encodeNotificationLine(notification)
			expect(line.includes("\n")).toBe(false)
			const decoded = yield* Schema.decodeUnknownEffect(SidecarNotificationLine)(line)
			expect(decoded.params.sessionId).toBe("session-9")
			expect(decoded.params.seq).toBe(42)
		}),
	)

	it.effect("uses null sessionId when the event is not session-tagged", () =>
		Effect.gen(function* () {
			const notification = yield* sidecarNotification({
				method: "history-index-changed",
				sessionId: null,
				payload: { projectPath: "/tmp" },
				seq: undefined,
			})
			expect(notification.params.sessionId).toBeNull()
			expect(notification.params.seq).toBeUndefined()
			const line = yield* encodeNotificationLine(notification)
			const decoded = yield* Schema.decodeUnknownEffect(SidecarNotificationLine)(line)
			expect(decoded.params.sessionId).toBeNull()
			expect(decoded.params.seq).toBeUndefined()
		}),
	)
})
