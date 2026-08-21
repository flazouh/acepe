import { describe, expect, it } from "bun:test";
import { MessageId, SessionId } from "@acepe/contracts";

import { compactionEntryFromProjectedMessage } from "./agent-panel-compaction.ts";

const sessionId = SessionId.make("session-1");
const messageId = MessageId.make("event-compact-1");

describe("compactionEntryFromProjectedMessage", () => {
	it("maps a completed compaction seam from the messages projection", () => {
		const entry = compactionEntryFromProjectedMessage({
			sessionId,
			sequence: 8,
			messageId,
			turnId: null,
			rowType: "compaction",
			content: {
				status: "completed",
				trigger: "auto",
				preCompactionTokens: 180000,
				postCompactionTokens: 42000,
				contextWindowSize: 200000,
				droppedTokens: 138000,
				summary: "Compaction done",
			},
		});

		expect(entry).toEqual({
			id: "event-compact-1",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compaction done",
			status: "completed",
			subtitle: "138,000 tokens freed",
			contextUsage: {
				preCompactionTokens: 180000,
				postCompactionTokens: 42000,
				contextWindowSize: 200000,
			},
			metadata: [{ label: "Trigger", value: "Auto" }],
		});
	});

	it("maps preparing without usage, gauges, or progress numbers", () => {
		const entry = compactionEntryFromProjectedMessage({
			sessionId,
			sequence: 3,
			messageId: MessageId.make("event-compact-prep"),
			turnId: null,
			rowType: "compaction",
			content: {
				status: "preparing",
				trigger: "manual",
				preCompactionTokens: 180000,
				postCompactionTokens: null,
				contextWindowSize: 200000,
				droppedTokens: null,
				summary: "Compaction preparing",
			},
		});

		expect(entry.status).toBe("preparing");
		expect(entry.title).toBe("Compaction preparing");
		expect(entry.subtitle).toBeUndefined();
		expect(entry.contextUsage).toBeUndefined();
		expect(entry.metadata).toBeUndefined();
	});

	it("maps failed compaction to the warning status with no fake progress", () => {
		const entry = compactionEntryFromProjectedMessage({
			sessionId,
			sequence: 9,
			messageId: MessageId.make("event-compact-fail"),
			turnId: null,
			rowType: "compaction",
			content: {
				status: "failed",
				trigger: "unknown",
				preCompactionTokens: null,
				postCompactionTokens: null,
				contextWindowSize: null,
				droppedTokens: null,
				summary: null,
			},
		});

		expect(entry).toEqual({
			id: "event-compact-fail",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compaction failed",
			status: "failed",
			metadata: [{ label: "Trigger", value: "Unknown" }],
		});
	});

	it("maps usage_reset with the context-meter subtitle", () => {
		const entry = compactionEntryFromProjectedMessage({
			sessionId,
			sequence: 10,
			messageId: MessageId.make("event-compact-reset"),
			turnId: null,
			rowType: "compaction",
			content: {
				status: "usage_reset",
				trigger: "auto",
				preCompactionTokens: null,
				postCompactionTokens: null,
				contextWindowSize: null,
				droppedTokens: null,
				summary: null,
			},
		});

		expect(entry.status).toBe("usage_reset");
		expect(entry.title).toBe("Compaction done");
		expect(entry.subtitle).toBe("Context meter reset");
	});
});
