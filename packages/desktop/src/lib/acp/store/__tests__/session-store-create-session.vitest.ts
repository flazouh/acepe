import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCanonicalSessionStateEnvelopeMock = vi.fn();
const sendPromptMock = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		fetchCanonicalSessionStateEnvelope: (
			...args: Parameters<typeof fetchCanonicalSessionStateEnvelopeMock>
		) => fetchCanonicalSessionStateEnvelopeMock(...args),
		sendPrompt: (...args: Parameters<typeof sendPromptMock>) => sendPromptMock(...args),
	},
}));

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

import type { SessionCold } from "../../application/dto/session-cold.js";
import { extractProjectName } from "../../utils/path-utils.js";
import { generateFallbackProjectColor } from "../../utils/project-utils.js";
import type { CreatedPendingSessionResult } from "../services/session-connection-manager.js";
import { SessionStore } from "../session-store.svelte.js";

function createPendingSessionResult(
	overrides: Partial<CreatedPendingSessionResult> = {}
): CreatedPendingSessionResult {
	const projectPath = overrides.projectPath ?? "/repo";
	return {
		kind: "pending",
		sessionId: overrides.sessionId ?? "provider-requested-id",
		creationAttemptId: overrides.creationAttemptId ?? "attempt-1",
		projectPath,
		projectName: overrides.projectName ?? extractProjectName(projectPath),
		projectColor: overrides.projectColor ?? generateFallbackProjectColor(projectPath),
		managed: true,
		sequenceId: overrides.sequenceId ?? null,
		agentId: overrides.agentId ?? "claude-code",
		title: overrides.title ?? "Build stable panels",
		worktreePath: overrides.worktreePath ?? null,
	};
}

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
		openPath: overrides.openPath ?? "legacy_rebuild",
		lastEventSeq: overrides.lastEventSeq ?? 0,
		graphRevision: overrides.graphRevision ?? overrides.lastEventSeq ?? 0,
		openToken: overrides.openToken ?? "open-token",
		agentId: overrides.agentId ?? "copilot",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		sequenceId: overrides.sequenceId ?? null,
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: overrides.lastEventSeq ?? 0,
			entries: [],
		},
		sessionTitle: overrides.sessionTitle ?? "New Thread",
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 0,
		activity: overrides.activity ?? {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		activeStreamingTail: overrides.activeStreamingTail ?? null,
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
		sequenceId: overrides.sequenceId ?? null,
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
		activeStreamingTail: overrides.activeStreamingTail ?? null,
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

function createSnapshotEnvelope(
	graph: SessionStateGraph = createSessionStateGraph()
): SessionStateEnvelope {
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
		sendPromptMock.mockReturnValue(okAsync(undefined));
	});

	it("returns minimal PR link references for a project", () => {
		store.write.setSessions([
			createSession({
				id: "linked-1",
				prNumber: 42,
				sequenceId: 7,
			}),
			createSession({
				id: "unlinked",
				updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			}),
			createSession({
				id: "other-project",
				projectPath: "/other",
				prNumber: 42,
				sequenceId: 3,
				updatedAt: new Date("2026-04-20T00:00:00.000Z"),
			}),
		]);

		expect(store.read.getSessionPrLinkReferencesForProject("/repo")).toEqual([
			{
				id: "linked-1",
				prNumber: 42,
				sequenceId: 7,
			},
		]);
		expect(store.read.getSessionIdsForProject("/repo")).toEqual(["linked-1", "unlinked"]);
		expect(store.read.getLiveSessionSyncReferences()).toEqual([
			{
				id: "linked-1",
				updatedAtMs: new Date("2026-04-18T00:00:00.000Z").getTime(),
			},
			{
				id: "unlinked",
				updatedAtMs: new Date("2026-04-19T00:00:00.000Z").getTime(),
			},
			{
				id: "other-project",
				updatedAtMs: new Date("2026-04-20T00:00:00.000Z").getTime(),
			},
		]);
		expect(store.read.getSessionPaletteReferences()).toEqual([
			{
				id: "linked-1",
				projectPath: "/repo",
				agentId: "copilot",
				title: "New Thread",
			},
			{
				id: "unlinked",
				projectPath: "/repo",
				agentId: "copilot",
				title: "New Thread",
			},
			{
				id: "other-project",
				projectPath: "/other",
				agentId: "copilot",
				title: "New Thread",
			},
		]);
		expect(store.read.getSessionPaletteReference("linked-1")).toEqual({
			id: "linked-1",
			projectPath: "/repo",
			agentId: "copilot",
			title: "New Thread",
		});
		expect(store.read.hasSession("linked-1")).toBe(true);
		expect(store.read.hasSession("missing-session")).toBe(false);
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

		store.connection.setSessionOpenHydrator({ hydrateCreated });
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

		const result = await store.connection.createSession({
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

		store.connection.setSessionOpenHydrator({ hydrateCreated });
		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() => errAsync(new Error("Provider crashed during session creation"))),
		};

		const result = await store.connection.createSession({
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
					awaiting_plan_approval: false,
					source_link: { kind: "transcript_linked", entry_id: "tc-1" },
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

		store.connection.setSessionOpenHydrator({ hydrateCreated });
		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync({
					kind: "ready" as const,
					session,
					sessionOpen: { outcome: "found" as const, ...sessionOpen },
				})
			),
		};

		await store.connection.createSession({ projectPath: "/repo", agentId: "copilot" });

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

			storeForProvider.connection.setSessionOpenHydrator({ hydrateCreated });
			storeWithInternals.connectionMgr = {
				createSession: vi.fn(() =>
					okAsync({
						kind: "ready" as const,
						session,
						sessionOpen: { outcome: "found" as const, ...sessionOpen },
					})
				),
			};

			const result = await storeForProvider.connection.createSession({
				projectPath: "/repo",
				agentId,
			});
			expect(result.isOk(), `createSession failed for agentId=${agentId}`).toBe(true);
			expect(
				hydrateCreated,
				`hydrateCreated not called for agentId=${agentId}`
			).toHaveBeenCalledTimes(1);
		}
	});

	it("registers an optimistic deferred session and reconciles it into the canonical graph on promotion", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() => okAsync(createPendingSessionResult())),
		};

		const result = await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual(createPendingSessionResult());
		// Optimistic identity is registered immediately (panel can resolve agent +
		// title), while still tracked as pending until canonical promotion.
		expect(store.read.getAllSessions()).toHaveLength(1);
		expect(store.connection.hasPendingCreationSession("provider-requested-id")).toBe(true);

		const materialized = store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "provider-requested-id",
				canonicalSessionId: "provider-requested-id",
				agentId: "claude-code",
				projectPath: "/repo",
				sequenceId: 50,
			})
		);

		expect(materialized).toBe(true);
		const sessions = store.read.getAllSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				id: "provider-requested-id",
				projectPath: "/repo",
				agentId: "claude-code",
				title: "Build stable panels",
				sequenceId: 50,
			})
		);
		expect(store.connection.hasPendingCreationSession("provider-requested-id")).toBe(false);
	});

	it("registers an optimistic session for deferred creation so the panel resolves identity and title immediately", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync(
					createPendingSessionResult({
						agentId: "claude-code",
						title: "Build stable panels",
					})
				)
			),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		// Identity + title must be resolvable from the cold registry BEFORE the
		// canonical graph materializes, so the agent panel shows the agent icon,
		// the working spark, and the user-derived title (not "Conversation in ...").
		expect(store.read.getSessionIdentity("provider-requested-id")).toEqual(
			expect.objectContaining({
				id: "provider-requested-id",
				projectPath: "/repo",
				agentId: "claude-code",
			})
		);
		expect(store.read.getSessionMetadata("provider-requested-id")?.title).toBe(
			"Build stable panels"
		);

		// Still tracked as pending and NOT yet canonical — only the optimistic
		// identity is promoted early; canonical authority arrives on promotion.
		expect(store.connection.hasPendingCreationSession("provider-requested-id")).toBe(true);
		expect(store.read.hasSessionCanonicalProjection("provider-requested-id")).toBe(false);
	});

	it("removes the optimistic deferred session when creation fails before materialization", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync(
					createPendingSessionResult({
						sessionId: "pending-session",
						title: "Failed Thread",
					})
				)
			),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		// Optimistic session is present after creation...
		expect(store.read.getSessionIdentity("pending-session")).toBeDefined();

		store.connection.failPendingCreationSession("pending-session", {
			type: "turnError",
			session_id: "pending-session",
			error: {
				message: "Claude provider session identity could not be verified",
				kind: "fatal",
				source: "transport",
			},
		});

		// ...and removed cleanly on terminal pre-materialization failure (no phantom row).
		expect(store.read.getSessionIdentity("pending-session")).toBeUndefined();
		expect(store.read.getAllSessions()).toEqual([]);
		expect(store.connection.hasPendingCreationSession("pending-session")).toBe(false);
	});

	it("materializes pending creation with projected sequence id before promotion", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() => okAsync(createPendingSessionResult({ sequenceId: 12 }))),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		expect(store.connection.materializePendingCreationSession("provider-requested-id")).toBe(true);
		expect(store.read.getSessionMetadata("provider-requested-id")?.sequenceId).toBe(12);
	});

	it("fills sequence id from pending creation when identity exists before graph sequence arrives", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() => okAsync(createPendingSessionResult({ sequenceId: 12 }))),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		store.write.addSession(
			createSession({
				id: "provider-requested-id",
				agentId: "claude-code",
				title: "Build stable panels",
			})
		);

		const materialized = store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "provider-requested-id",
				canonicalSessionId: "provider-requested-id",
				agentId: "claude-code",
				projectPath: "/repo",
				sequenceId: null,
			})
		);

		expect(materialized).toBe(true);
		expect(store.read.getSessionMetadata("provider-requested-id")?.sequenceId).toBe(12);
	});

	it("fills sequence id when an early event materializes a deferred session before the graph", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() => okAsync(createPendingSessionResult())),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		expect(store.connection.materializePendingCreationSession("provider-requested-id")).toBe(true);
		expect(store.read.getSessionMetadata("provider-requested-id")?.sequenceId).toBeUndefined();

		const materialized = store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "provider-requested-id",
				canonicalSessionId: "provider-requested-id",
				agentId: "claude-code",
				projectPath: "/repo",
				sequenceId: 56,
			})
		);

		expect(materialized).toBe(true);
		expect(store.read.getSessionMetadata("provider-requested-id")?.sequenceId).toBe(56);
		expect(store.read.getAllSessions()[0]).toEqual(
			expect.objectContaining({
				id: "provider-requested-id",
				sequenceId: 56,
			})
		);
	});

	it("fills a null placeholder sequence from the canonical graph", () => {
		store.write.addSession(
			createSession({
				id: "claude-created-session",
				agentId: "claude-code",
				sequenceId: null,
			})
		);

		const materialized = store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "claude-created-session",
				canonicalSessionId: "claude-created-session",
				agentId: "claude-code",
				projectPath: "/repo",
				sequenceId: 59,
			})
		);

		expect(materialized).toBe(true);
		expect(store.read.getSessionMetadata("claude-created-session")?.sequenceId).toBe(59);
	});

	it("fills a null placeholder sequence when a known live session receives a full graph", () => {
		store.write.addSession(
			createSession({
				id: "claude-live-session",
				agentId: "claude-code",
				sequenceId: null,
			})
		);

		store.applySessionStateGraph(
			createSessionStateGraph({
				requestedSessionId: "claude-live-session",
				canonicalSessionId: "claude-live-session",
				agentId: "claude-code",
				projectPath: "/repo",
				sequenceId: 62,
			})
		);

		expect(store.read.getSessionMetadata("claude-live-session")?.sequenceId).toBe(62);
	});

	it("preserves the canonical open snapshot sequence on an existing created session", () => {
		store.write.addSession(
			createSession({
				id: "snapshot-session",
				title: "Session snapshot-session",
				sequenceId: undefined,
			})
		);

		store.write.replaceSessionOpenSnapshot(
			createSessionOpenFound({
				canonicalSessionId: "snapshot-session",
				requestedSessionId: "snapshot-session",
				sessionTitle: "Can you find a svelte component that is too big ?",
				sequenceId: 57,
			})
		);

		expect(store.read.getSessionMetadata("snapshot-session")?.title).toBe(
			"Can you find a svelte component that is too big ?"
		);
		expect(store.read.getSessionMetadata("snapshot-session")?.sequenceId).toBe(57);
	});

	it("treats a materialized created session as enough authority for detail lookup", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() => okAsync(createPendingSessionResult())),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		store.ensureSessionFromStateGraph(
			createSessionStateGraph({
				requestedSessionId: "provider-requested-id",
				canonicalSessionId: "provider-requested-id",
				agentId: "claude-code",
				projectPath: "/repo",
			})
		);

		expect(store.read.hasSessionCanonicalProjection("provider-requested-id")).toBe(false);
		expect(store.read.getSessionDetail("provider-requested-id")).toMatchObject({
			id: "provider-requested-id",
			projectPath: "/repo",
			agentId: "claude-code",
			title: "Build stable panels",
			sessionLifecycleState: "created",
		});
	});

	it("materializes an aliased pending creation from the requested id into the canonical id", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync(
					createPendingSessionResult({
						sessionId: "requested-local-id",
						title: "Aliased Thread",
					})
				)
			),
		};

		await store.connection.createSession({
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
		const sessions = store.read.getAllSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				id: "provider-canonical-id",
				title: "Aliased Thread",
			})
		);
		expect(store.connection.hasPendingCreationSession("requested-local-id")).toBe(false);
		expect(store.connection.hasPendingCreationSession("provider-canonical-id")).toBe(false);
	});

	it("migrates the first-send pending intent when an aliased pending creation becomes canonical", async () => {
		vi.spyOn(store.connectionMgr, "createSession").mockReturnValue(
			okAsync(
				createPendingSessionResult({
					sessionId: "requested-local-id",
					title: "Aliased Thread",
				})
			)
		);

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		const sendResult = await store.connection.sendMessage(
			"requested-local-id",
			"first prompt survives promotion"
		);
		expect(sendResult.isOk()).toBe(true);
		const requestedPending = store.read.getSessionPendingSendIntent("requested-local-id");
		expect(requestedPending).toMatchObject({
			attemptId: expect.any(String),
			optimisticEntry: {
				type: "user",
				message: {
					content: { type: "text", text: "first prompt survives promotion" },
				},
			},
		});
		expect(store.read.getSessionPendingSendIntent("provider-canonical-id")).toBeNull();

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
		expect(store.read.getSessionPendingSendIntent("provider-canonical-id")).toEqual(
			requestedPending
		);
		expect(store.read.getSessionPendingSendIntent("requested-local-id")).toBeNull();
	});

	it("removes pending creation when a terminal creation error arrives before materialization", async () => {
		const storeWithInternals = store as unknown as {
			connectionMgr: {
				createSession: ReturnType<typeof vi.fn>;
			};
		};

		storeWithInternals.connectionMgr = {
			createSession: vi.fn(() =>
				okAsync(
					createPendingSessionResult({
						sessionId: "pending-session",
						title: "Failed Thread",
					})
				)
			),
		};

		await store.connection.createSession({
			projectPath: "/repo",
			agentId: "claude-code",
		});

		store.connection.failPendingCreationSession("pending-session", {
			type: "turnError",
			session_id: "pending-session",
			error: {
				message: "Claude provider session identity could not be verified",
				kind: "fatal",
				source: "transport",
			},
		});

		expect(store.connection.hasPendingCreationSession("pending-session")).toBe(false);
		expect(store.read.hasSessionCanonicalProjection("pending-session")).toBe(false);

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

		expect(store.read.getSessionLifecycleStatus("pending-session")).toBe("failed");
		expect(store.read.getSessionTurnState("pending-session")).toBe("Failed");
	});
});
