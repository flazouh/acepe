import { describe, expect, it } from "bun:test";
import { emptyRpcSessionSnapshot, MessageId, ProjectId, SessionId } from "@acepe/contracts";

import { transcriptRowsFromSnapshot } from "./session-transcript-state.ts";

const sessionId = SessionId.make("session-1");
const projectId = ProjectId.make("project-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

describe("transcriptRowsFromSnapshot", () => {
	it("keeps snapshot message order and skips compaction rows", () => {
		const rows = transcriptRowsFromSnapshot({
			snapshotSequence: 5,
			session: {
				sessionId,
				projectId,
				title: "First session",
				provider: null,
				createdAt: occurredAt,
				updatedAt: occurredAt,
				lastActivityAt: occurredAt,
				archivedAt: null,
				deletedAt: null,
				prNumber: null,
				prLinkMode: null,
			},
			messages: [
				{
					sessionId,
					sequence: 3,
					messageId: MessageId.make("message-user"),
					turnId: null,
					rowType: "user",
					content: { text: "Ping" },
				},
				{
					sessionId,
					sequence: 4,
					messageId: MessageId.make("message-compact"),
					turnId: null,
					rowType: "compaction",
					content: {
						status: "completed",
						trigger: "auto",
						preCompactionTokens: null,
						postCompactionTokens: null,
						contextWindowSize: null,
						droppedTokens: null,
						summary: null,
					},
				},
				{
					sessionId,
					sequence: 4,
					messageId: MessageId.make("message-assistant"),
					turnId: null,
					rowType: "assistant",
					content: { text: "Hello from Acepe." },
				},
			],
			turns: [],
			activities: [],
			pendingApprovals: [],
			checkpoints: [],
			projects: [],
			sessions: [],
			settings: [],
			skillsCatalog: null,
			voice: null,
		});
		expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
		expect(rows.map((row) => row.text)).toEqual(["Ping", "Hello from Acepe."]);
	});

	it("returns no rows for an empty snapshot", () => {
		expect(transcriptRowsFromSnapshot(emptyRpcSessionSnapshot(0))).toEqual([]);
	});
});
