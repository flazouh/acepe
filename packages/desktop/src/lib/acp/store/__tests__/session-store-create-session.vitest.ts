import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	SessionOpenFound,
	SessionStateEnvelope,
	SessionStateGraph,
} from "$lib/services/acp-types.js";

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
		lifecycle: overrides.lifecycle ?? {
			status: "ready",
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: false,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		capabilities: overrides.capabilities ?? {},
	};
}

function createSessionStateGraph(overrides: Partial<SessionStateGraph> = {}): SessionStateGraph {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		agentId: overrides.agentId ?? "copilot",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		revision: overrides.revision ?? {
			graphRevision: 1,
			transcriptRevision: 0,
			lastEventSeq: 1,
		},
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: 0,
			entries: [],
		},
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 0,
		activeTurnFailure: overrides.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? null,
		lifecycle: overrides.lifecycle ?? {
			status: "ready",
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: false,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		activity: overrides.activity ?? {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		capabilities: overrides.capabilities ?? {},
	};
}

function createSnapshotEnvelope(graph: SessionStateGraph = createSessionStateGraph()): SessionStateEnvelope {
	return {
		sessionId: graph.canonicalSessionId,
		graphRevision: graph.revision.graphRevision,
		lastEventSeq: graph.revision.lastEventSeq,
		payload: {
			kind: "snapshot",
			graph,
		},
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
					kind: "ready" as const,
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
		expect(result._unsafeUnwrap()).toEqual({ kind: "ready", session });
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
			createSession: vi.fn(() => errAsync(new Error("Provider crashed during session creation"))),
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
					provider_status: "completed",
					operation_state: "completed",
					title: "Read file.ts",
					arguments: { kind: "read", file_path: "file.ts" },
					progressive_arguments: null,
					result: null,
					command: null,
					normalized_todos: null,
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
					kind: "ready" as const,
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
				operations: expect.arrayContaining([expect.objectContaining({ id: "op-1", name: "Read" })]),
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
						kind: "ready" as const,
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

	it("tracks deferred creation without adding a real session until canonical graph promotion", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync({
					kind: "pending" as const,
					sessionId: "provider-requested-id",
					creationAttemptId: "attempt-1",
					projectPath: "/repo",
					agentId: "claude-code",
					title: "Build stable panels",
					worktreePath: null,
				})
			),
		};

		const result = await store.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			kind: "pending",
			sessionId: "provider-requested-id",
			creationAttemptId: "attempt-1",
			projectPath: "/repo",
			agentId: "claude-code",
			title: "Build stable panels",
			worktreePath: null,
		});
		expect(store.sessions).toEqual([]);
		expect(store.hasPendingCreationSession("provider-requested-id")).toBe(true);

		const materialized = store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "provider-requested-id",
				canonicalSessionId: "provider-requested-id",
				agentId: "claude-code",
				projectPath: "/repo",
			})
		);

		expect(materialized).toBe(true);
		expect(store.sessions).toHaveLength(1);
		expect(store.sessions[0]).toEqual(
			expect.objectContaining({
				id: "provider-requested-id",
				projectPath: "/repo",
				agentId: "claude-code",
				title: "Build stable panels",
			})
		);
		expect(store.hasPendingCreationSession("provider-requested-id")).toBe(false);
	});

	it("materializes an aliased pending creation from the requested id into the canonical id", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync({
					kind: "pending" as const,
					sessionId: "requested-local-id",
					creationAttemptId: "attempt-1",
					projectPath: "/repo",
					agentId: "claude-code",
					title: "Aliased Thread",
					worktreePath: null,
				})
			),
		};

		await store.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		const materialized = store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "requested-local-id",
				canonicalSessionId: "provider-canonical-id",
				isAlias: true,
				agentId: "claude-code",
				projectPath: "/repo",
			})
		);

		expect(materialized).toBe(true);
		expect(store.sessions).toHaveLength(1);
		expect(store.sessions[0]).toEqual(
			expect.objectContaining({
				id: "provider-canonical-id",
				title: "Aliased Thread",
			})
		);
		expect(store.hasPendingCreationSession("requested-local-id")).toBe(false);
		expect(store.hasPendingCreationSession("provider-canonical-id")).toBe(false);
	});

	it("removes pending creation when a terminal creation error arrives before materialization", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync({
					kind: "pending" as const,
					sessionId: "pending-session",
					creationAttemptId: "attempt-1",
					projectPath: "/repo",
					agentId: "claude-code",
					title: "Failed Thread",
					worktreePath: null,
				})
			),
		};

		await store.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		store.failPendingCreationSession("pending-session", {
			type: "turnError",
			session_id: "pending-session",
			error: {
				message: "Claude provider session identity could not be verified",
				kind: "fatal",
				source: "transport",
			},
		});

		expect(store.hasPendingCreationSession("pending-session")).toBe(false);
		expect(store.getHotState("pending-session")).toEqual(
			expect.objectContaining({
				status: "error",
				turnState: "error",
			})
		);
		expect(store.getCanonicalSessionProjection("pending-session")).toBeNull();

		store.applySessionStateEnvelope(
			"pending-session",
			createSnapshotEnvelope(
				createSessionStateGraph({
					requestedSessionId: "pending-session",
					canonicalSessionId: "pending-session",
					agentId: "claude-code",
					projectPath: "/repo",
					revision: {
						graphRevision: 2,
						transcriptRevision: 0,
						lastEventSeq: 2,
					},
					turnState: "Failed",
					activeTurnFailure: {
						turn_id: null,
						message: "Claude provider session identity could not be verified",
						kind: "fatal",
						source: "transport",
					},
					lifecycle: {
						status: "failed",
						failureReason: "explicitErrorHandlingRequired",
						errorMessage: "Claude provider session identity could not be verified",
						actionability: {
							canSend: false,
							canResume: false,
							canRetry: true,
							canArchive: true,
							canConfigure: true,
							recommendedAction: "retry",
							recoveryPhase: "failed",
							compactStatus: "failed",
						},
					},
					activity: {
						kind: "error",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
				})
			)
		);

		expect(store.getCanonicalSessionProjection("pending-session")).toMatchObject({
			lifecycle: {
				status: "failed",
			},
			turnState: "Failed",
		});
	});
});
