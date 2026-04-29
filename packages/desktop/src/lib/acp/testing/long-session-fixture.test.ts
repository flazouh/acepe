import { describe, expect, it } from "bun:test";

import {
	createLongSessionFixture,
	LONG_SESSION_FIXTURE_ASSUMPTIONS,
} from "./long-session-fixture.js";

describe("long-session fixture", () => {
	it("creates short, long, and doubled variants with the same changed operation payload", () => {
		const shortFixture = createLongSessionFixture({
			scale: "short",
			sessionId: "session-perf",
		});
		const longFixture = createLongSessionFixture({
			scale: "long",
			sessionId: "session-perf",
		});
		const doubledFixture = createLongSessionFixture({
			scale: "doubled",
			sessionId: "session-perf",
		});

		expect(longFixture.entries.length).toBeGreaterThan(shortFixture.entries.length);
		expect(doubledFixture.entries.length).toBe(longFixture.entries.length * 2);
		expect(longFixture.operationSnapshots.length).toBeGreaterThan(
			shortFixture.operationSnapshots.length
		);
		expect(doubledFixture.operationSnapshots.length).toBe(
			longFixture.operationSnapshots.length * 2
		);
		expect(JSON.stringify(shortFixture.changedOperationSnapshot)).toBe(
			JSON.stringify(longFixture.changedOperationSnapshot)
		);
		expect(JSON.stringify(longFixture.changedOperationSnapshot)).toBe(
			JSON.stringify(doubledFixture.changedOperationSnapshot)
		);
	});

	it("contains mixed transcript entries, completed operations, and one active streaming turn", () => {
		const fixture = createLongSessionFixture({
			scale: "long",
			sessionId: "session-perf",
		});

		expect(fixture.entries.some((entry) => entry.type === "user")).toBe(true);
		expect(fixture.entries.some((entry) => entry.type === "assistant")).toBe(true);
		expect(fixture.entries.some((entry) => entry.type === "tool_call")).toBe(true);
		expect(fixture.operationSnapshots.some((operation) => operation.provider_status === "completed")).toBe(
			true
		);
		expect(fixture.changedOperationSnapshot.provider_status).toBe("in_progress");
		expect(fixture.activeStreamingOperationId).toBe(fixture.changedOperationSnapshot.id);
		expect(
			fixture.operationSnapshots.filter((operation) => operation.provider_status === "in_progress")
		).toHaveLength(1);
	});

	it("records fixture assumptions when real failure-session calibration is unavailable", () => {
		const fixture = createLongSessionFixture({ scale: "long" });

		expect(fixture.metadata.assumptions).toBe(LONG_SESSION_FIXTURE_ASSUMPTIONS);
		expect(fixture.metadata.failureSessionCalibration).toBe("unvalidated");
		expect(fixture.metadata.transcriptEntryCount).toBe(fixture.entries.length);
		expect(fixture.metadata.completedOperationCount).toBe(
			fixture.operationSnapshots.filter((operation) => operation.provider_status === "completed")
				.length
		);
	});
});
