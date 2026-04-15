import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setThinkingBlockCollapsedByDefaultMock = vi.fn();
const setStreamingAnimationModeMock = vi.fn();
const setPreferInlineMock = vi.fn();

const chatPrefs = {
	thinkingBlockCollapsedByDefault: false,
	streamingAnimationMode: "classic",
	setThinkingBlockCollapsedByDefault: setThinkingBlockCollapsedByDefaultMock,
	setStreamingAnimationMode: setStreamingAnimationModeMock,
	isReady: true,
};

const planPrefs = {
	preferInline: true,
	setPreferInline: setPreferInlineMock,
};

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("$lib/acp/store/chat-preferences-store.svelte.js", () => ({
	getChatPreferencesStore: () => chatPrefs,
}));

vi.mock("$lib/acp/store/plan-preference-store.svelte.js", () => ({
	getPlanPreferenceStore: () => planPrefs,
}));

import ChatSection from "./chat-section.svelte";

describe("ChatSection", () => {
	beforeEach(() => {
		setThinkingBlockCollapsedByDefaultMock.mockReset();
		setStreamingAnimationModeMock.mockReset();
		setPreferInlineMock.mockReset();
		chatPrefs.thinkingBlockCollapsedByDefault = false;
		chatPrefs.streamingAnimationMode = "classic";
		planPrefs.preferInline = true;
	});

	it("renders streaming animation trigger with current mode label and description", () => {
		const view = render(ChatSection);
		const trigger = view.container.querySelector(
			'[aria-label="Streaming animation"]'
		);

		expect(trigger).not.toBeNull();
		expect(trigger!.textContent).toContain("Classic");
		expect(view.getByText("Choose how assistant text appears while it streams in.")).toBeTruthy();
	});

	it("renders trigger with smooth label when mode is smooth", () => {
		chatPrefs.streamingAnimationMode = "smooth";
		const view = render(ChatSection);
		const trigger = view.container.querySelector(
			'[aria-label="Streaming animation"]'
		);

		expect(trigger).not.toBeNull();
		expect(trigger!.textContent).toContain("Smooth");
	});
});
