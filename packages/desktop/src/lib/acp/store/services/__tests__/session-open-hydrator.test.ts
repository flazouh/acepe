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
	let replaceSessionProjection: ReturnType<typeof mock>;
	let hydrator: SessionOpenHydrator;

	beforeEach(() => {
		replaceSessionOpenSnapshot = mock(() => {});
		updatePanelSession = mock(() => {});
		replaceSessionProjection = mock(() => {});
		hydrator = new SessionOpenHydrator(
			{
				replaceSessionOpenSnapshot,
			},
			{
				updatePanelSession,
			},
			{
				replaceSessionProjection,
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
		expect(replaceSessionProjection).toHaveBeenCalledTimes(1);
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
		expect(replaceSessionProjection).not.toHaveBeenCalled();
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
		expect(replaceSessionProjection).toHaveBeenCalledTimes(1);
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
		expect(replaceSessionProjection).toHaveBeenCalledTimes(1);
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
