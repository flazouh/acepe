import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import type {
	ArchivedSessionRef,
	ThreadListSettings,
} from "../../../services/thread-list-settings.js";

import {
	createArchivedSessionKey,
	normalizeThreadListSettings,
	SessionArchiveStore,
} from "../session-archive-store.svelte.js";

class FakeThreadListSettingsClient {
	settings: ThreadListSettings = {
		hiddenProjects: ["/existing/project"],
		archivedSessions: [],
	};

	saveCalls: ThreadListSettings[] = [];

	getSettings() {
		return Effect.succeed(this.settings);
	}

	saveSettings(settings: ThreadListSettings) {
		this.settings = settings;
		this.saveCalls.push(settings);
		return Effect.succeed(undefined);
	}
}

describe("createArchivedSessionKey", () => {
	it("uses composite identity to avoid collisions", () => {
		const a = createArchivedSessionKey({
			sessionId: "s1",
			projectPath: "/repo-a",
			agentId: "claude-code",
		});
		const b = createArchivedSessionKey({
			sessionId: "s1",
			projectPath: "/repo-b",
			agentId: "claude-code",
		});
		const c = createArchivedSessionKey({
			sessionId: "s1",
			projectPath: "/repo-a",
			agentId: "cursor",
		});

		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
	});
});

describe("normalizeThreadListSettings", () => {
	it("adds archivedSessions when missing", () => {
		const normalized = normalizeThreadListSettings({
			hiddenProjects: ["/repo"],
		});

		expect(normalized).toEqual({
			hiddenProjects: ["/repo"],
			archivedSessions: [],
		});
	});
});

describe("SessionArchiveStore", () => {
	it("loads archived sessions and reports membership", async () => {
		const client = new FakeThreadListSettingsClient();
		const archived: ArchivedSessionRef = {
			sessionId: "s1",
			projectPath: "/repo",
			agentId: "claude-code",
		};
		client.settings = {
			hiddenProjects: [],
			archivedSessions: [archived],
		};

		const store = new SessionArchiveStore(client);
		const result = await Effect.runPromise(Effect.result(store.load()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(store.isArchived(archived)).toBe(true);
	});

	it("archives idempotently and preserves hiddenProjects", async () => {
		const client = new FakeThreadListSettingsClient();
		const store = new SessionArchiveStore(client);
		await Effect.runPromise(store.load());

		const session: ArchivedSessionRef = {
			sessionId: "s1",
			projectPath: "/repo",
			agentId: "claude-code",
		};

		await Effect.runPromise(store.archive(session));
		await Effect.runPromise(store.archive(session));

		expect(store.isArchived(session)).toBe(true);
		expect(client.settings.hiddenProjects).toEqual(["/existing/project"]);
		expect(client.settings.archivedSessions).toHaveLength(1);
	});

	it("unarchives by exact composite identity", async () => {
		const client = new FakeThreadListSettingsClient();
		client.settings = {
			hiddenProjects: [],
			archivedSessions: [
				{ sessionId: "same", projectPath: "/repo-a", agentId: "claude-code" },
				{ sessionId: "same", projectPath: "/repo-b", agentId: "claude-code" },
			],
		};

		const store = new SessionArchiveStore(client);
		await Effect.runPromise(store.load());

		await Effect.runPromise(store.unarchive({
			sessionId: "same",
			projectPath: "/repo-a",
			agentId: "claude-code",
		}));

		expect(
			store.isArchived({
				sessionId: "same",
				projectPath: "/repo-a",
				agentId: "claude-code",
			})
		).toBe(false);
		expect(
			store.isArchived({
				sessionId: "same",
				projectPath: "/repo-b",
				agentId: "claude-code",
			})
		).toBe(true);
	});
});
