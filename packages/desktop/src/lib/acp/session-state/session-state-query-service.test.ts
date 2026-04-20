import { describe, expect, it } from "vitest";

import type { SessionStateDelta } from "../../services/acp-types.js";
import { resolveSessionStateDelta } from "./session-state-query-service.js";

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
