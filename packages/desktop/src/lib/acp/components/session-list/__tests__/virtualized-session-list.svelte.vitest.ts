import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import type { SessionListItem } from "../session-list-types.js";
import VirtualizedSessionList from "../virtualized-session-list.svelte";

function createSessionItem(overrides?: Partial<SessionListItem>): SessionListItem {
	const createdAt = new Date("2026-05-24T08:00:00.000Z");
	const updatedAt = new Date("2026-05-24T08:10:00.000Z");
	return {
		id: "session-1",
		title: "Render session",
		projectPath: "/repo",
		projectName: "repo",
		projectColor: "#22c55e",
		projectIconSrc: null,
		agentId: "codex",
		createdAt,
		updatedAt,
		isLive: false,
		isOpen: false,
		activity: null,
		parentId: null,
		insertions: 97,
		deletions: 750,
		entryCount: 581,
		sequenceId: 6,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

describe("VirtualizedSessionList", () => {
	it("renders session rows without tripping the session item boundary", () => {
		const view = render(VirtualizedSessionList, {
			sessions: [createSessionItem()],
			selectedSessionId: null,
			onSelectSession: () => undefined,
		});

		expect(view.queryByText("Failed to render session.")).toBeNull();
		expect(view.getByText("Render session")).not.toBeNull();
	});
});
