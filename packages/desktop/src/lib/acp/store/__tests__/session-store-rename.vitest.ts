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
	sessionsByProject: Map<string, SessionCold[]>;
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
		store.write.addSession({
			id: "session-rename-1",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Original title",
			updatedAt,
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});

		(api.setSessionTitle as unknown as MockReturnValue).mockReturnValue(okAsync(undefined));

		const result = await store.write.renameSession("session-rename-1", "  Renamed title  ");

		expect(result.isOk()).toBe(true);
		expect(api.setSessionTitle).toHaveBeenCalledWith("session-rename-1", "Renamed title");
		expect(store.read.getSessionCold("session-rename-1")?.title).toBe("Renamed title");
		expect(store.read.getSessionCold("session-rename-1")?.updatedAt.toISOString()).toBe(
			updatedAt.toISOString()
		);
	});

	it("adds a session without copying the existing session list", () => {
		store.write.addSession({
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
		// biome-ignore lint/correctness/useYield: This sentinel iterator intentionally throws before yielding.
		sessions[Symbol.iterator] = function* () {
			throw new Error("must not iterate existing sessions while adding a session");
		};

		try {
			store.write.addSession({
				id: "session-new",
				projectPath: "/project",
				agentId: "claude-code",
				title: "New",
				updatedAt: new Date("2026-04-06T11:00:00.000Z"),
				createdAt: new Date("2026-04-06T11:00:00.000Z"),
				parentId: null,
			});

			expect(store.read.getSessionCold("session-new")?.title).toBe("New");
			expect(store.read.getSessionCold("session-existing")?.title).toBe("Existing");
		} finally {
			sessions[Symbol.iterator] = originalIterator;
		}
	});

	it("updates one session without mapping the whole session list", () => {
		store.write.addSession({
			id: "session-one",
			projectPath: "/project",
			agentId: "claude-code",
			title: "One",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		store.write.addSession({
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
			store.write.updateSession("session-one", { title: "One updated" }, { touchUpdatedAt: false });

			expect(store.read.getSessionCold("session-one")?.title).toBe("One updated");
			expect(store.read.getSessionCold("session-two")?.title).toBe("Two");
		} finally {
			sessions.map = originalMap;
		}
	});

	it("looks up a session by id without rebuilding a derived session map", () => {
		store.write.addSession({
			id: "session-indexed",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Indexed",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		const sessions = (store as unknown as StoreWithPrivateSessions).sessions;
		const originalMap = sessions.map;
		sessions.map = () => {
			throw new Error("must not rebuild session id map for a lookup");
		};

		try {
			expect(store.read.getSessionCold("session-indexed")?.title).toBe("Indexed");
			expect(store.read.hasSession("session-indexed")).toBe(true);
		} finally {
			sessions.map = originalMap;
		}
	});

	it("looks up project sessions without rebuilding all project groups", () => {
		store.write.addSession({
			id: "session-project-a",
			projectPath: "/project-a",
			agentId: "claude-code",
			title: "Project A",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		store.write.addSession({
			id: "session-project-b",
			projectPath: "/project-b",
			agentId: "claude-code",
			title: "Project B",
			updatedAt: new Date("2026-04-06T11:00:00.000Z"),
			createdAt: new Date("2026-04-06T11:00:00.000Z"),
			parentId: null,
		});
		const sessions = (store as unknown as StoreWithPrivateSessions).sessions;
		const originalIterator = sessions[Symbol.iterator];
		// biome-ignore lint/correctness/useYield: This sentinel iterator intentionally throws before yielding.
		sessions[Symbol.iterator] = function* () {
			throw new Error("must not regroup every session for a project lookup");
		};

		try {
			expect(store.read.getSessionIdsForProject("/project-a")).toEqual(["session-project-a"]);
			expect(store.read.getSessionIdsForProject("/project-b")).toEqual(["session-project-b"]);
		} finally {
			sessions[Symbol.iterator] = originalIterator;
		}
	});

	it("looks up project session ids without mapping project sessions", () => {
		store.write.addSession({
			id: "session-project-a",
			projectPath: "/project-a",
			agentId: "claude-code",
			title: "Project A",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		const projectSessions = (store as unknown as StoreWithPrivateSessions).sessionsByProject.get(
			"/project-a"
		);
		expect(projectSessions).toBeDefined();
		const originalMap = projectSessions!.map;
		projectSessions!.map = () => {
			throw new Error("must not map project sessions for project id lookup");
		};

		try {
			expect(store.read.getSessionIdsForProject("/project-a")).toEqual(["session-project-a"]);
		} finally {
			projectSessions!.map = originalMap;
		}
	});

	it("returns session reference selectors without mapping the session list", () => {
		store.write.addSession({
			id: "session-reference",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Reference",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		const sessions = (store as unknown as StoreWithPrivateSessions).sessions;
		const originalMap = sessions.map;
		sessions.map = () => {
			throw new Error("must not map every session for reference selectors");
		};

		try {
			const paletteReferences = store.read.getSessionPaletteReferences();
			expect(paletteReferences).toHaveLength(1);
			expect(paletteReferences[0]).toEqual({
				id: "session-reference",
				projectPath: "/project",
				agentId: "claude-code",
				title: "Reference",
			});
			const syncReferences = store.read.getLiveSessionSyncReferences();
			expect(syncReferences).toHaveLength(1);
			expect(syncReferences[0]).toEqual({
				id: "session-reference",
				updatedAtMs: Date.parse("2026-04-06T10:00:00.000Z"),
			});

			store.write.updateSession(
				"session-reference",
				{ title: "Reference updated" },
				{ touchUpdatedAt: false }
			);

			expect(store.read.getSessionPaletteReferences()[0]?.title).toBe("Reference updated");
			expect(store.read.getLiveSessionSyncReferences()[0]?.updatedAtMs).toBe(
				Date.parse("2026-04-06T10:00:00.000Z")
			);
		} finally {
			sessions.map = originalMap;
		}
	});

	it("snapshots all sessions without using the broad session map helper", () => {
		store.write.addSession({
			id: "session-snapshot",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Snapshot",
			updatedAt: new Date("2026-04-06T10:00:00.000Z"),
			createdAt: new Date("2026-04-06T09:00:00.000Z"),
			parentId: null,
		});
		const sessions = (store as unknown as StoreWithPrivateSessions).sessions;
		const originalMap = sessions.map;
		sessions.map = () => {
			throw new Error("must not use sessions.map for all-session snapshots");
		};

		try {
			const snapshot = store.read.getAllSessions();

			expect(snapshot).toHaveLength(1);
			expect(snapshot[0]?.id).toBe("session-snapshot");
			expect(snapshot[0]).not.toBe(sessions[0]);
		} finally {
			sessions.map = originalMap;
		}
	});
});
