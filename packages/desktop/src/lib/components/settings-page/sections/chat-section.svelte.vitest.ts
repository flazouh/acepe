import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setThinkingBlockCollapsedByDefaultMock = vi.fn();
const setPreferInlineMock = vi.fn();

const chatPrefs = {
	thinkingBlockCollapsedByDefault: false,
	setThinkingBlockCollapsedByDefault: setThinkingBlockCollapsedByDefaultMock,
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
		setPreferInlineMock.mockReset();
		chatPrefs.thinkingBlockCollapsedByDefault = false;
		planPrefs.preferInline = true;
	});

	it("renders the thinking and plan controls without a streaming animation selector", () => {
		const view = render(ChatSection);

		expect(view.container.querySelector('[aria-label="Streaming animation"]')).toBeNull();
		expect(view.getByText("Thinking block collapsed by default")).toBeTruthy();
		expect(view.getByText("Inline plan display")).toBeTruthy();
	});
});
