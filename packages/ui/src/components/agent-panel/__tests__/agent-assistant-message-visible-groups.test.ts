import { expect, test } from "bun:test";

import {
	resolveVisibleAssistantMessageGroups,
	shouldStreamAssistantThoughtContent,
} from "../agent-assistant-message-visible-groups.js";

test("returns all message groups unchanged", () => {
	const fullText =
		"The **Ahsoka** show takes place around **9 ABY**, which is about **5 years after *Return of the Jedi***.";
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [{ type: "text", text: fullText }],
	});

	expect(visibleGroups).toEqual([{ type: "text", text: fullText }]);
});

test("message groups keep full canonical text across adjacent groups", () => {
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [
			{ type: "text", text: "first " },
			{ type: "text", text: "second answer" },
		],
	});

	expect(visibleGroups).toEqual([
		{ type: "text", text: "first " },
		{ type: "text", text: "second answer" },
	]);
});

test("keeps trailing non-text groups visible", () => {
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [
			{ type: "text", text: "answer" },
			{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
		],
	});

	expect(visibleGroups).toEqual([
		{ type: "text", text: "answer" },
		{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
	]);
});

test("returns a fresh copy of the input array", () => {
	const messageGroups = [{ type: "text" as const, text: "answer" }];
	const visibleGroups = resolveVisibleAssistantMessageGroups({ messageGroups });

	expect(visibleGroups).toEqual(messageGroups);
	expect(visibleGroups).not.toBe(messageGroups);
});

test("assistant thought content streams only before message content starts", () => {
	expect(
		shouldStreamAssistantThoughtContent({
			isStreaming: true,
			hasMessageContent: false,
			isLastThoughtTextGroup: true,
		})
	).toBe(true);
	expect(
		shouldStreamAssistantThoughtContent({
			isStreaming: true,
			hasMessageContent: true,
			isLastThoughtTextGroup: true,
		})
	).toBe(false);
	expect(
		shouldStreamAssistantThoughtContent({
			isStreaming: true,
			hasMessageContent: false,
			isLastThoughtTextGroup: false,
		})
	).toBe(false);
});
