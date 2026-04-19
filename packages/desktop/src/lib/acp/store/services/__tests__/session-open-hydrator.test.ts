import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { SessionOpenFound } from "../../../../services/acp-types.js";
import { SessionOpenHydrator } from "../session-open-hydrator.js";

function createFoundResult(
	overrides?: Partial<SessionOpenFound>
): SessionOpenFound {
	const requestedSessionId = overrides?.requestedSessionId ?? "requested-session";
	const canonicalSessionId = overrides?.canonicalSessionId ?? "canonical-session";
	const isAlias = overrides?.isAlias ?? false;
	const lastEventSeq = overrides?.lastEventSeq ?? 3;
	const openToken = overrides?.openToken ?? "open-token";
	const agentId = overrides?.agentId ?? "copilot";
	const projectPath = overrides?.projectPath ?? "/repo";
	const worktreePath = overrides?.worktreePath ?? null;
	const sourcePath = overrides?.sourcePath ?? "/repo/.copilot/session.jsonl";
	const transcriptSnapshot = overrides?.transcriptSnapshot ?? {
		revision: lastEventSeq,
		entries: [],
	};
	const sessionTitle = overrides?.sessionTitle ?? "Hydrated session";
	const operations = overrides?.operations ?? [];
	const interactions = overrides?.interactions ?? [];
	const turnState = overrides?.turnState ?? "Idle";
	const messageCount = overrides?.messageCount ?? 0;
	return {
		requestedSessionId,
		canonicalSessionId,
		isAlias,
		lastEventSeq,
		openToken,
		agentId,
		projectPath,
		worktreePath,
		sourcePath,
		transcriptSnapshot,
		sessionTitle,
		operations,
		interactions,
		turnState,
		messageCount,
	};
}

describe("SessionOpenHydrator", () => {
	let replaceSessionOpenSnapshot: ReturnType<typeof mock>;
	let updatePanelSession: ReturnType<typeof mock>;
	let replaceSessionStateGraph: ReturnType<typeof mock>;
	let hydrator: SessionOpenHydrator;

	beforeEach(() => {
		replaceSessionOpenSnapshot = mock(() => {});
		updatePanelSession = mock(() => {});
		replaceSessionStateGraph = mock(() => {});
		hydrator = new SessionOpenHydrator(
			{
				replaceSessionOpenSnapshot,
			},
			{
				updatePanelSession,
			},
			{
				replaceSessionStateGraph,
			}
		);
	});

	it("hydrates a found snapshot into the session, panel, and projection stores", async () => {
		const requestToken = hydrator.beginAttempt("panel-1");

		const result = await hydrator.hydrateFound("panel-1", requestToken, createFoundResult());

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			canonicalSessionId: "canonical-session",
			openToken: "open-token",
			applied: true,
		});
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
		expect(updatePanelSession).toHaveBeenCalledWith("panel-1", "canonical-session");
		expect(replaceSessionStateGraph).toHaveBeenCalledTimes(1);
	});

	it("ignores stale request tokens", async () => {
		hydrator.beginAttempt("panel-1");
		const activeToken = hydrator.beginAttempt("panel-1");

		const result = await hydrator.hydrateFound(
			"panel-1",
			"session-open-1",
			createFoundResult()
		);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			canonicalSessionId: "canonical-session",
			openToken: "open-token",
			applied: false,
		});
		expect(activeToken).toBe("session-open-2");
		expect(replaceSessionOpenSnapshot).not.toHaveBeenCalled();
		expect(updatePanelSession).not.toHaveBeenCalled();
		expect(replaceSessionStateGraph).not.toHaveBeenCalled();
	});

	it("ignores equal revisions for the same canonical session", async () => {
		const requestToken = hydrator.beginAttempt("panel-1");
		await hydrator.hydrateFound("panel-1", requestToken, createFoundResult());

		const second = await hydrator.hydrateFound("panel-1", requestToken, createFoundResult());

		expect(second.isOk()).toBe(true);
		expect(second._unsafeUnwrap()).toEqual({
			canonicalSessionId: "canonical-session",
			openToken: "open-token",
			applied: false,
		});
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
	});

	it("ignores older revisions after a newer snapshot was applied", async () => {
		const requestToken = hydrator.beginAttempt("panel-1");
		await hydrator.hydrateFound(
			"panel-1",
			requestToken,
			createFoundResult({ lastEventSeq: 5 })
		);

		const older = await hydrator.hydrateFound(
			"panel-1",
			requestToken,
			createFoundResult({ lastEventSeq: 4 })
		);

		expect(older.isOk()).toBe(true);
		expect(older._unsafeUnwrap()).toEqual({
			canonicalSessionId: "canonical-session",
			openToken: "open-token",
			applied: false,
		});
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
	});

	it("hydrates created sessions without rebinding a panel", async () => {
		const result = await hydrator.hydrateCreated(createFoundResult());

		expect(result.isOk()).toBe(true);
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
		expect(replaceSessionStateGraph).toHaveBeenCalledTimes(1);
		expect(updatePanelSession).not.toHaveBeenCalled();
	});

	// ==========================================================================
	// Unit 0: Characterization — pre-cutover session hydration invariants
	// ==========================================================================

	it("[characterize] pre-cutover session with no sourcePath hydrates successfully through open path", async () => {
		// A session recorded before the canonical materialization was in place will
		// arrive with sourcePath: null and lastEventSeq: 0. It must still hydrate
		// through the current open path without error.
		const requestToken = hydrator.beginAttempt("panel-pre-cutover");

		const result = await hydrator.hydrateFound(
			"panel-pre-cutover",
			requestToken,
			createFoundResult({
				sourcePath: null,
				lastEventSeq: 0,
				transcriptSnapshot: { revision: 0, entries: [] },
				operations: [],
				interactions: [],
			})
		);

		expect(result.isOk()).toBe(true);
		const applied = result._unsafeUnwrap();
		expect(applied.applied).toBe(true);
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
		expect(replaceSessionStateGraph).toHaveBeenCalledTimes(1);
	});

	// ==========================================================================
	// U7 E2E proof: canonical snapshot invariants
	// ==========================================================================

	it("[E2E] openToken from found result is preserved verbatim through hydrateFound", async () => {
		// The hydrator must surface the exact openToken from the backend result so the
		// caller can thread it into reconnect without the token being altered or dropped.
		const requestToken = hydrator.beginAttempt("panel-e2e");
		const specificToken = "backend-issued-token-deadbeef";

		const result = await hydrator.hydrateFound(
			"panel-e2e",
			requestToken,
			createFoundResult({ openToken: specificToken })
		);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().openToken).toBe(specificToken);
	});

	it("[E2E] replaceSessionOpenSnapshot is called with the canonical session id even for alias opens", async () => {
		// When an alias is resolved, the hydrator must apply the snapshot under the
		// canonical id so downstream delta events keyed by canonical id merge correctly.
		const requestToken = hydrator.beginAttempt("panel-e2e-alias");

		const result = await hydrator.hydrateFound(
			"panel-e2e-alias",
			requestToken,
			createFoundResult({
				requestedSessionId: "alias-id",
				canonicalSessionId: "canonical-id",
				isAlias: true,
			})
		);

		expect(result.isOk()).toBe(true);
		const applied = result._unsafeUnwrap();
		expect(applied.canonicalSessionId).toBe("canonical-id");
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
		// The snapshot payload must carry the canonical session id
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const snapshotArg = (replaceSessionOpenSnapshot.mock.calls as any)[0]?.[0];
		expect(snapshotArg?.canonicalSessionId).toBe("canonical-id");
	});

	it("[E2E] replaceSessionStateGraph is called exactly once per hydrateFound — no double-hydration", async () => {
		// Regression guard: open-time graph snapshot must be applied exactly once.
		// A double-hydrate would leave the UI in a partially-reset state.
		const requestToken = hydrator.beginAttempt("panel-e2e-single");

		await hydrator.hydrateFound("panel-e2e-single", requestToken, createFoundResult());

		expect(replaceSessionStateGraph).toHaveBeenCalledTimes(1);
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
	});

	it("[characterize] session with in-progress operations preserves those operations through hydration", async () => {
		// A session reopened during an active tool call must carry the in-progress
		// operation in the hydrated snapshot so the UI renders the in-flight state.
		const requestToken = hydrator.beginAttempt("panel-with-ops");

		const inProgressOperation = {
			id: "op-read-1",
			session_id: "canonical-session",
			tool_call_id: "tool-read-1",
			name: "Read",
			kind: "read" as const,
			status: "in_progress" as const,
			title: "Read /repo/src/main.ts",
			arguments: { kind: "read" as const, file_path: "/repo/src/main.ts" },
			progressive_arguments: null,
			result: null,
			command: null,
			parent_tool_call_id: null,
			parent_operation_id: null,
			child_tool_call_ids: [],
			child_operation_ids: [],
		};

		const result = await hydrator.hydrateFound("panel-with-ops", requestToken, {
			...createFoundResult({ lastEventSeq: 5 }),
			operations: [inProgressOperation],
		});

		expect(result.isOk()).toBe(true);
		expect(replaceSessionOpenSnapshot).toHaveBeenCalledTimes(1);
		// The snapshot passed to replaceSessionOpenSnapshot must carry the operation
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const snapshotArg = (replaceSessionOpenSnapshot.mock.calls as any)[0]?.[0];
		expect(snapshotArg?.operations).toHaveLength(1);
		expect(snapshotArg?.operations[0]?.id).toBe("op-read-1");
		expect(snapshotArg?.operations[0]?.status).toBe("in_progress");
	});
});
