import { errAsync, okAsync } from "neverthrow";
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
		graphRevision: overrides.graphRevision ?? overrides.lastEventSeq ?? 0,
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

	// ==========================================================================
	// Unit 0: Characterization — crash/recovery and error path invariants
	// ==========================================================================

	it("[characterize] error path: createSession propagates connection error without silently diverging", async () => {
		// If the underlying connection fails (e.g. crash/recovery scenario), the
		// result must surface as an error so callers can decide how to recover
		// rather than silently ending up with a partially-initialized session.
		const hydrateCreated = vi.fn(() => okAsync(undefined));
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		store.setSessionOpenHydrator({ hydrateCreated });
		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				errAsync(new Error("Provider crashed during session creation"))
			),
		};

		const result = await store.createSession({
			projectPath: "/repo",
			agentId: "copilot",
		});

		// Must propagate as Err — no silent divergence
		expect(result.isErr()).toBe(true);
		// Must not partially hydrate when the connection itself failed
		expect(hydrateCreated).not.toHaveBeenCalled();
	});

	// ==========================================================================
	// Unit 6: No duplicate authority — canonical snapshot hydrator is the sole
	// authority for session open, regardless of provider.
	// ==========================================================================

	it("[U6] snapshot hydrator receives operations from the session-open result", async () => {
		// Operations must reach the hydrator so projection consumers (OperationStore)
		// are authoritative from first open — no secondary path should be needed.
		const session = createSession();
		const sessionOpen = createSessionOpenFound({
			operations: [
				{
					id: "op-1",
					session_id: "session-1",
					tool_call_id: "tc-1",
					name: "Read",
					kind: "read",
					status: "completed",
					title: "Read file.ts",
					arguments: { kind: "read", file_path: "file.ts" },
					progressive_arguments: null,
					result: null,
					command: null,
					parent_tool_call_id: null,
					parent_operation_id: null,
					child_tool_call_ids: [],
					child_operation_ids: [],
				},
			],
		});

		const hydrateCreated = vi.fn(() => okAsync(undefined));
		const storeWithInternals = store as unknown as {
			connectionMgr: { createSession: ReturnType<typeof vi.fn> };
		};

		store.setSessionOpenHydrator({ hydrateCreated });
		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync({
					session,
					sessionOpen: { outcome: "found" as const, ...sessionOpen },
				})
			),
		};

		await store.createSession({ projectPath: "/repo", agentId: "copilot" });

		// The hydrator must receive the full snapshot including operations
		expect(hydrateCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: "found",
				operations: expect.arrayContaining([
					expect.objectContaining({ id: "op-1", name: "Read" }),
				]),
			})
		);
	});

	it("[U6] any provider agentId goes through the same canonical createSession path", async () => {
		// Prove there is no provider-name branch gating the hydrator call.
		// copilot, opencode, codex, cursor, claude-code must all hydrate via hydrateCreated.
		const providers = ["copilot", "opencode", "codex", "cursor", "claude-code"] as const;

		for (const agentId of providers) {
			const session = createSession({ agentId });
			const sessionOpen = createSessionOpenFound({ agentId });
			const hydrateCreated = vi.fn(() => okAsync(undefined));
			const storeForProvider = new (store.constructor as new () => typeof store)();
			const storeWithInternals = storeForProvider as unknown as {
				connectionMgr: { createSession: ReturnType<typeof vi.fn> };
			};

			storeForProvider.setSessionOpenHydrator({ hydrateCreated });
			storeWithInternals.connectionMgr = {
				createSession: vi.fn(() =>
					okAsync({
						session,
						sessionOpen: { outcome: "found" as const, ...sessionOpen },
					})
				),
			};

			const result = await storeForProvider.createSession({ projectPath: "/repo", agentId });
			expect(result.isOk(), `createSession failed for agentId=${agentId}`).toBe(true);
			expect(
				hydrateCreated,
				`hydrateCreated not called for agentId=${agentId}`
			).toHaveBeenCalledTimes(1);
		}
	});
});
