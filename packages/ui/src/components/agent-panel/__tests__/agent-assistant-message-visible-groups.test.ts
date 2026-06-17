import { expect, test } from "bun:test";

import {
	resolveThoughtGroupTokenRevealCss,
	resolveVisibleAssistantMessageGroups,
	shouldStreamAssistantTextContent,
	shouldStreamAssistantThoughtContent,
} from "../agent-assistant-message-visible-groups.js";
import type { TokenRevealCss } from "../types.js";

test("active token timing does not hide canonical text within the current text group", () => {
	const fullText =
		"The **Ahsoka** show takes place around **9 ABY**, which is about **5 years after *Return of the Jedi***.";
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [{ type: "text", text: fullText }],
		isStreaming: true,
		tokenRevealCss: {
			revealCount: 15,
			revealedCharCount: fullText.length,
			baselineMs: -64,
			tokStepMs: 32,
			tokFadeDurMs: 420,
			mode: "smooth",
		},
		lastMessageTextGroupIndex: 0,
	});

	expect(visibleGroups).toEqual([{ type: "text", text: fullText }]);
});

test("message groups keep full canonical text across adjacent groups", () => {
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [
			{ type: "text", text: "first " },
			{ type: "text", text: "second answer" },
		],
		lastMessageTextGroupIndex: 1,
	});

	expect(visibleGroups).toEqual([
		{ type: "text", text: "first " },
		{ type: "text", text: "second answer" },
	]);
});

test("settled rows keep trailing non-text groups visible", () => {
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [
			{ type: "text", text: "answer" },
			{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
		],
		lastMessageTextGroupIndex: 0,
	});

	expect(visibleGroups).toEqual([
		{ type: "text", text: "answer" },
		{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
	]);
});

test("settled rows ignore stale token reveal timing and keep restored text visible", () => {
	const text =
		"My last message was:\n\n> There's a fully-built `AgentInputAutonomousToggle` component in `@acepe/ui` - but it's **not wired into the desktop toolbar at all**.";
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [{ type: "text", text }],
		isStreaming: false,
		tokenRevealCss: {
			revealCount: 1,
			revealedCharCount: 0,
			baselineMs: -32,
			tokStepMs: 32,
			tokFadeDurMs: 420,
			mode: "smooth",
		},
		lastMessageTextGroupIndex: 0,
	});

	expect(visibleGroups).toEqual([{ type: "text", text }]);
});

test("active token timing hides trailing non-text groups until text settles", () => {
	const visibleGroups = resolveVisibleAssistantMessageGroups({
		messageGroups: [
			{ type: "text", text: "answer" },
			{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
		],
		isStreaming: true,
		tokenRevealCss: {
			revealCount: 1,
			revealedCharCount: "answer".length,
			baselineMs: -32,
			tokStepMs: 32,
			tokFadeDurMs: 420,
			mode: "smooth",
		},
		lastMessageTextGroupIndex: 0,
	});

	expect(visibleGroups).toEqual([{ type: "text", text: "answer" }]);
});

test("assistant text content streams only while token timing is absent", () => {
	expect(
		shouldStreamAssistantTextContent({
			isStreaming: true,
			tokenRevealCss: {
				revealCount: 1,
				revealedCharCount: 5,
				baselineMs: -32,
				tokStepMs: 32,
				tokFadeDurMs: 420,
				mode: "smooth",
			},
		})
	).toBe(false);
	expect(shouldStreamAssistantTextContent({ isStreaming: true })).toBe(true);
	expect(shouldStreamAssistantTextContent({ isStreaming: false })).toBe(false);
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

const thoughtRevealCss: TokenRevealCss = {
	revealCount: 3,
	revealedCharCount: 12,
	baselineMs: -16,
	tokStepMs: 0,
	tokFadeDurMs: 630,
	mode: "smooth",
};

test("thinking body reveals with the active token timing while thinking, before message content", () => {
	expect(
		resolveThoughtGroupTokenRevealCss({
			isStreaming: true,
			hasMessageContent: false,
			isLastThoughtTextGroup: true,
			activeTokenRevealCss: thoughtRevealCss,
		})
	).toEqual(thoughtRevealCss);
});

test("thinking body reveal is confined to the last thought group", () => {
	expect(
		resolveThoughtGroupTokenRevealCss({
			isStreaming: true,
			hasMessageContent: false,
			isLastThoughtTextGroup: false,
			activeTokenRevealCss: thoughtRevealCss,
		})
	).toBeUndefined();
});

test("thinking body stops revealing once message content begins streaming", () => {
	expect(
		resolveThoughtGroupTokenRevealCss({
			isStreaming: true,
			hasMessageContent: true,
			isLastThoughtTextGroup: true,
			activeTokenRevealCss: thoughtRevealCss,
		})
	).toBeUndefined();
});

test("thinking body does not reveal when not streaming", () => {
	expect(
		resolveThoughtGroupTokenRevealCss({
			isStreaming: false,
			hasMessageContent: false,
			isLastThoughtTextGroup: true,
			activeTokenRevealCss: thoughtRevealCss,
		})
	).toBeUndefined();
});
