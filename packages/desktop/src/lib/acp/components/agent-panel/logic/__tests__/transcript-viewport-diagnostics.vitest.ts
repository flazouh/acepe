import { describe, expect, it } from "vitest";
import {
	createTranscriptViewportDiagnostics,
	recordTranscriptViewportDiagnostic,
} from "../transcript-viewport-diagnostics.js";

describe("TranscriptViewportDiagnostics", () => {
	it("keeps a bounded text-free event history", () => {
		const diagnostics = createTranscriptViewportDiagnostics({ limit: 2 });
		const first = recordTranscriptViewportDiagnostic(diagnostics, {
			schemaVersion: 1,
			sessionId: "session-1",
			generation: 0,
			eventType: "RowsChanged",
			follow: "following",
			renderer: "primary",
			anchor: "tail",
			rowCount: 1,
			effectTypes: ["RevealTail"],
		});
		const second = recordTranscriptViewportDiagnostic(first, {
			schemaVersion: 1,
			sessionId: "session-1",
			generation: 0,
			eventType: "UserScroll",
			follow: "detached",
			renderer: "primary",
			anchor: "row:user-1",
			rowCount: 1,
			effectTypes: [],
		});
		const third = recordTranscriptViewportDiagnostic(second, {
			schemaVersion: 1,
			sessionId: "session-1",
			generation: 0,
			eventType: "RowsChanged",
			follow: "detached",
			renderer: "primary",
			anchor: "row:user-1",
			rowCount: 2,
			effectTypes: ["PreserveAnchor"],
		});

		expect(third.records).toHaveLength(2);
		expect(third.records.map((record) => record.eventType)).toEqual(["UserScroll", "RowsChanged"]);
		expect(JSON.stringify(third)).not.toContain("message text");
	});
});
