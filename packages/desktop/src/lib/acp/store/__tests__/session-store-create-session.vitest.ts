import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionOpenFound } from "$lib/services/acp-types.js";

vi.mock("$lib/analytics.js", () => ({
	captureException: vi.fn(),
	initAnalytics: vi.fn(),
	setAnalyticsEnabled: vi.fn(),
}));

import type { SessionCold } from "../../application/dto/session.js";
import { SessionStore } from "../session-store.svelte.js";

function createSession(overrides: Partial<SessionCold> = {}): SessionCold {
	return {
		id: "session-1",
		projectPath: "/repo",
		agentId: "copilot",
		title: "New Thread",
		updatedAt: new Date("2026-04-18T00:00:00.000Z"),
		createdAt: new Date("2026-04-18T00:00:00.000Z"),
		sessionLifecycleState: "created",
		parentId: null,
		...overrides,
	};
}

function createSessionOpenFound(overrides: Partial<SessionOpenFound> = {}): SessionOpenFound {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		lastEventSeq: overrides.lastEventSeq ?? 0,
		openToken: overrides.openToken ?? "open-token",
		agentId: overrides.agentId ?? "copilot",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: overrides.lastEventSeq ?? 0,
			entries: [],
		},
		sessionTitle: overrides.sessionTitle ?? "New Thread",
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 0,
	};
}

describe("SessionStore.createSession", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		vi.clearAllMocks();
	});

	it("hydrates the canonical session-open snapshot returned during session creation", async () => {
		const session = createSession();
		const sessionOpen = createSessionOpenFound();
		const hydrateCreated = vi.fn(() => okAsync(undefined));
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		store.setSessionOpenHydrator({ hydrateCreated });
		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync({
					session,
					sessionOpen: {
						outcome: "found" as const,
						...sessionOpen,
					},
				})
			),
		};

		const result = await store.createSession({
			projectPath: "/repo",
			agentId: "copilot",
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual(session);
		expect(hydrateCreated).toHaveBeenCalledWith({
			outcome: "found",
			...sessionOpen,
		});
	});
});
