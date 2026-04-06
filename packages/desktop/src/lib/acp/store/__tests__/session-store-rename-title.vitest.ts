import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({
	api: {
		setSessionTitle: vi.fn(),
	},
}));

import { api } from "../api.js";
import { SessionStore } from "../session-store.svelte.js";

describe("SessionStore renameSession", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		vi.clearAllMocks();
		vi.mocked(api.setSessionTitle).mockReturnValue(okAsync(undefined));
	});

	it("trims and persists a renamed session title", async () => {
		store.addSession({
			id: "session-rename",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Old Title",
			updatedAt: new Date(1000),
			createdAt: new Date(500),
			parentId: null,
		});

		const result = await store.renameSession("session-rename", "  new title  ");

		expect(result.isOk()).toBe(true);
		expect(api.setSessionTitle).toHaveBeenCalledWith("session-rename", "new title");
		expect(store.getSessionCold("session-rename")?.title).toBe("new title");
	});
});
