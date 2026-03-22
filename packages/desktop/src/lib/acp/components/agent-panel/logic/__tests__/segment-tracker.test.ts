import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../../application/dto/session.js";
import {
	buildSegments,
	type ConversationSegment,
	findSegmentForIndex,
} from "../segment-tracker.js";
import {
	createAssistantEntry,
	createToolCallEntry,
	createUserEntry,
} from "./session-entry-factories.js";

describe("buildSegments", () => {
	it("returns empty array for empty entries", () => {
		const result = buildSegments([]);
		expect(result).toEqual([]);
	});

	it("returns empty array when no user messages exist", () => {
		const entries: SessionEntry[] = [createAssistantEntry("a1"), createToolCallEntry("t1")];
		const result = buildSegments(entries);
		expect(result).toEqual([]);
	});

	it("creates single segment for one user message", () => {
		const userEntry = createUserEntry("u1");
		const entries: SessionEntry[] = [userEntry];

		const result = buildSegments(entries);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			userMessageIndex: 0,
			userMessage: userEntry,
			startIndex: 0,
			endIndex: 1,
		});
	});

	it("creates single segment with user message and following entries", () => {
		const userEntry = createUserEntry("u1");
		const entries: SessionEntry[] = [
			userEntry,
			createAssistantEntry("a1"),
			createToolCallEntry("t1"),
		];

		const result = buildSegments(entries);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			userMessageIndex: 0,
			userMessage: userEntry,
			startIndex: 0,
			endIndex: 3,
		});
	});

	it("creates multiple segments for multiple user messages", () => {
		const user1 = createUserEntry("u1");
		const user2 = createUserEntry("u2");
		const entries: SessionEntry[] = [
			user1,
			createAssistantEntry("a1"),
			user2,
			createAssistantEntry("a2"),
			createToolCallEntry("t1"),
		];

		const result = buildSegments(entries);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			userMessageIndex: 0,
			userMessage: user1,
			startIndex: 0,
			endIndex: 2,
		});
		expect(result[1]).toEqual({
			userMessageIndex: 2,
			userMessage: user2,
			startIndex: 2,
			endIndex: 5,
		});
	});

	it("handles consecutive user messages", () => {
		const user1 = createUserEntry("u1");
		const user2 = createUserEntry("u2");
		const user3 = createUserEntry("u3");
		const entries: SessionEntry[] = [user1, user2, user3];

		const result = buildSegments(entries);

		expect(result).toHaveLength(3);
		expect(result[0].startIndex).toBe(0);
		expect(result[0].endIndex).toBe(1);
		expect(result[1].startIndex).toBe(1);
		expect(result[1].endIndex).toBe(2);
		expect(result[2].startIndex).toBe(2);
		expect(result[2].endIndex).toBe(3);
	});

	it("handles entries before first user message", () => {
		const userEntry = createUserEntry("u1");
		const entries: SessionEntry[] = [
			createAssistantEntry("a0"), // orphan entry before user
			userEntry,
			createAssistantEntry("a1"),
		];

		const result = buildSegments(entries);

		// Only one segment starting from user message
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			userMessageIndex: 1,
			userMessage: userEntry,
			startIndex: 1,
			endIndex: 3,
		});
	});
});

describe("findSegmentForIndex", () => {
	const user1 = createUserEntry("u1");
	const user2 = createUserEntry("u2");
	const segments: ConversationSegment[] = [
		{
			userMessageIndex: 0,
			userMessage: user1,
			startIndex: 0,
			endIndex: 3,
		},
		{
			userMessageIndex: 3,
			userMessage: user2,
			startIndex: 3,
			endIndex: 6,
		},
	];

	it("returns null for empty segments array", () => {
		const result = findSegmentForIndex([], 0);
		expect(result).toBeNull();
	});

	it("returns null for index before all segments", () => {
		const segmentsWithGap: ConversationSegment[] = [
			{
				userMessageIndex: 2,
				userMessage: user1,
				startIndex: 2,
				endIndex: 5,
			},
		];
		const result = findSegmentForIndex(segmentsWithGap, 0);
		expect(result).toBeNull();
	});

	it("returns null for index after all segments", () => {
		const result = findSegmentForIndex(segments, 10);
		expect(result).toBeNull();
	});

	it("finds segment for index at segment start", () => {
		const result = findSegmentForIndex(segments, 0);
		expect(result).toBe(segments[0]);
	});

	it("finds segment for index in middle of segment", () => {
		const result = findSegmentForIndex(segments, 1);
		expect(result).toBe(segments[0]);
	});

	it("finds segment for index at segment boundary (exclusive end)", () => {
		// Index 3 is the start of segment 2, not part of segment 1
		const result = findSegmentForIndex(segments, 3);
		expect(result).toBe(segments[1]);
	});

	it("finds correct segment for index in second segment", () => {
		const result = findSegmentForIndex(segments, 4);
		expect(result).toBe(segments[1]);
	});

	it("finds segment for last valid index", () => {
		const result = findSegmentForIndex(segments, 5);
		expect(result).toBe(segments[1]);
	});
});
