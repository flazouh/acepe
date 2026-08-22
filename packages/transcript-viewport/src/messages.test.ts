import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts"
import { MessageId, SessionId } from "@acepe/contracts"
import { describe, expect, it } from "bun:test"

import { rowsFromProjectedMessages } from "./messages.ts"

const sessionId = SessionId.make("session-1")
const occurredSequence = 3

const user = (input: {
	readonly messageId: string
	readonly sequence: number
	readonly text: string
}): RpcProjectedMessage => ({
	sessionId,
	sequence: input.sequence,
	messageId: MessageId.make(input.messageId),
	turnId: null,
	rowType: "user",
	content: { text: input.text },
})

const assistant = (input: {
	readonly messageId: string
	readonly sequence: number
	readonly text: string
}): RpcProjectedMessage => ({
	sessionId,
	sequence: input.sequence,
	messageId: MessageId.make(input.messageId),
	turnId: null,
	rowType: "assistant",
	content: { text: input.text },
})

const compaction = (input: {
	readonly messageId: string
	readonly sequence: number
	readonly summary: string | null
}): RpcProjectedMessage => ({
	sessionId,
	sequence: input.sequence,
	messageId: MessageId.make(input.messageId),
	turnId: null,
	rowType: "compaction",
	content: {
		status: "completed",
		trigger: "auto",
		preCompactionTokens: 1000,
		postCompactionTokens: 400,
		contextWindowSize: 200000,
		droppedTokens: 600,
		summary: input.summary,
	},
})

describe("rowsFromProjectedMessages", () => {
	it("preserves projection order and uses messageId as the display row id", () => {
		const messages = [
			user({ messageId: "message-user", sequence: 3, text: "Ping" }),
			assistant({ messageId: "message-assistant", sequence: 8, text: "Pong" }),
		]
		const rows = rowsFromProjectedMessages(messages)
		expect(rows[0]?.rowId).toBe("message-user")
		expect(rows[0]?.sequence).toBe(3)
		expect(rows[0]?.rowType).toBe("user")
		expect(rows[0]?.text).toBe("Ping")
		expect(rows[0]?.anchorEligible).toBe(true)
		expect(rows[0]?.isActiveTail).toBe(false)
		expect(rows[1]?.rowId).toBe("message-assistant")
		expect(rows[1]?.isActiveTail).toBe(true)
		expect(rows[1]?.anchorEligible).toBe(false)
	})

	it("does not re-sort out-of-order input; projection order is display order", () => {
		const messages = [
			assistant({ messageId: "later", sequence: 9, text: "Second" }),
			user({ messageId: "earlier", sequence: 2, text: "First" }),
		]
		const rows = rowsFromProjectedMessages(messages)
		expect(rows[0]?.rowId).toBe("later")
		expect(rows[1]?.rowId).toBe("earlier")
	})

	it("maps compaction seams as first-class rows", () => {
		const rows = rowsFromProjectedMessages([
			compaction({ messageId: "seam-1", sequence: 4, summary: "Dropped history" }),
		])
		expect(rows[0]?.rowType).toBe("compaction")
		expect(rows[0]?.text).toBe("Dropped history")
		expect(rows[0]?.anchorEligible).toBe(false)
		expect(rows[0]?.isActiveTail).toBe(false)
	})

	it("reads only snapshot.messages from a session snapshot", () => {
		const snapshot: RpcSessionSnapshot = {
			snapshotSequence: occurredSequence,
			session: null,
			messages: [user({ messageId: "only-messages", sequence: 3, text: "Hi" })],
			turns: [],
			activities: [],
			pendingApprovals: [],
			projects: [],
			sessions: [],
			settings: [],
		}
		const rows = rowsFromProjectedMessages(snapshot.messages)
		expect(rows.length).toBe(1)
		expect(rows[0]?.rowId).toBe("only-messages")
	})
})
