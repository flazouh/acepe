import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({
	api: {
		getSession: vi.fn(),
		scanSessions: vi.fn(),
		sendPrompt: vi.fn(),
		setSessionTitle: vi.fn(),
	},
}));

import { api } from "../api.js";
import { SessionStore } from "../session-store.svelte.js";
import type { SessionCold } from "../types.js";

type StoreWithPrivateSessions = {
	sessions: SessionCold[];
};

type MockReturnValue = {
	mockReturnValue: (value: unknown) => void;
};

describe("SessionStore renameSession", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		vi.clearAllMocks();
	});

	it("persists a trimmed session title override without reordering the session", async () => {
		const updatedAt = new Date("2026-04-06T10:00:00.000Z");
		store.addSession({
			id: "session-rename-1",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Original title",
			updatedAt,
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});

		(api.setSessionTitle as unknown as MockReturnValue).mockReturnValue(okAsync(undefined));

		const result = await store.renameSession("session-rename-1", "  Renamed title  ");

		expect(result.isOk()).toBe(true);
		expect(api.setSessionTitle).toHaveBeenCalledWith("session-rename-1", "Renamed title");
		expect(store.getSessionCold("session-rename-1")?.title).toBe("Renamed title");
		expect(store.getSessionCold("session-rename-1")?.updatedAt.toISOString()).toBe(
			updatedAt.toISOString()
		);
	});

	it("adds a session without copying the existing session list", () => {
		store.addSession({
			id: "session-existing",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Existing",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		const sessions = (store as unknown as StoreWithPrivateSessions).sessions;
		const originalIterator = sessions[Symbol.iterator];
		sessions[Symbol.iterator] = function* () {
			throw new Error("must not iterate existing sessions while adding a session");
		};

		try {
			store.addSession({
				id: "session-new",
				projectPath: "/project",
				agentId: "claude-code",
				title: "New",
				updatedAt: new Date("2026-04-06T11:00:00.000Z"),
				createdAt: new Date("2026-04-06T11:00:00.000Z"),
				parentId: null,
			});

			expect(store.getSessionCold("session-new")?.title).toBe("New");
			expect(store.getSessionCold("session-existing")?.title).toBe("Existing");
		} finally {
			sessions[Symbol.iterator] = originalIterator;
		}
	});

	it("updates one session without mapping the whole session list", () => {
		store.addSession({
			id: "session-one",
			projectPath: "/project",
			agentId: "claude-code",
			title: "One",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		store.addSession({
			id: "session-two",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Two",
			updatedAt: new Date("2026-04-06T11:00:00.000Z"),
			createdAt: new Date("2026-04-06T11:00:00.000Z"),
			parentId: null,
		});
		const sessions = (store as unknown as StoreWithPrivateSessions).sessions;
		const originalMap = sessions.map;
		sessions.map = () => {
			throw new Error("must not map every session while updating one session");
		};

		try {
			store.updateSession("session-one", { title: "One updated" }, { touchUpdatedAt: false });

			expect(store.getSessionCold("session-one")?.title).toBe("One updated");
			expect(store.getSessionCold("session-two")?.title).toBe("Two");
		} finally {
			sessions.map = originalMap;
		}
	});
});
