import { describe, expect, it } from "vitest";

import type { SessionStateDelta } from "../../services/acp-types.js";
import {
	isOperationBlockedByPermission,
	operationHasRawEvidence,
	resolveOperationDisplayTitle,
	resolveOperationKnownCommand,
	resolveSessionStateDelta,
} from "./session-state-query-service.js";

describe("resolveSessionStateDelta", () => {
	it("does not refresh when only the graph frontier advances", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 4,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 7,
				transcriptRevision: 4,
				lastEventSeq: 7,
			},
			transcriptOperations: [],
			changedFields: ["capabilities"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "noop",
		});
	});

	it("refreshes when the transcript frontier diverges", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 5,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 8,
				transcriptRevision: 7,
				lastEventSeq: 8,
			},
			transcriptOperations: [],
			changedFields: ["transcriptSnapshot"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "refreshSnapshot",
			fromRevision: 5,
			toRevision: 7,
		});
	});
});

describe("operation query selectors", () => {
	it("derives display title and known command from canonical operation evidence", () => {
		expect(
			resolveOperationDisplayTitle({
				title: "Read",
				name: "Read",
				arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
			})
		).toBe("Read /tmp/example.txt");

		expect(
			resolveOperationKnownCommand({
				command: null,
				arguments: { kind: "execute", command: "git   status" },
				progressive_arguments: null,
				title: "`git status`",
			})
		).toBe("git status");
	});

	it("surfaces blocked-by-permission and raw evidence availability", () => {
		expect(
			isOperationBlockedByPermission({
				lifecycle: "blocked",
				blocked_reason: "permission",
			})
		).toBe(true);
		expect(
			operationHasRawEvidence({
				title: "Read /tmp/example.txt",
				command: null,
				result: null,
				locations: [{ path: "/tmp/example.txt" }],
				skill_meta: null,
				normalized_todos: null,
			})
		).toBe(true);
		expect(
			operationHasRawEvidence({
				title: "Read",
				command: null,
				result: null,
				locations: null,
				skill_meta: null,
				normalized_todos: null,
			})
		).toBe(false);
	});
});
