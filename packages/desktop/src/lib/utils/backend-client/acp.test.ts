import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	RpcAgentCallError,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { rootCauseMessage } from "../../acp/errors/error-cause-details.js";
import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { acp } from "./acp.ts";

const sessionId = SessionId.make("session-1");

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const withSession = (
	snapshot: RpcSessionSnapshot,
	session: RpcSessionSnapshot["session"]
): RpcSessionSnapshot => ({
	...snapshot,
	session,
});

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readImageDataUrl: () => Effect.succeed("data:image/png;base64,"),
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () => Effect.succeed({ sessionId, imported: false }),
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("acp backend client", () => {
	it("sendPrompt joins text blocks and dispatches message.send", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.sendPrompt("session-1", [
					{ type: "text", text: "reply with exactly: ACP_SLICE_42" },
				]);
				expect(dispatched).toHaveLength(1);
				expect(dispatched[0]).toMatchObject({
					type: "message.send",
					sessionId: "session-1",
					text: "reply with exactly: ACP_SLICE_42",
				});
			})
		));

	it("cancel dispatches turn.cancel", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.cancel("session-1");
				expect(dispatched.map((command) => command.type)).toEqual(["turn.cancel"]);
				expect(dispatched[0]).toMatchObject({ sessionId: "session-1" });
			})
		));

	it("newSession creates a project for an unknown cwd and dispatches session.create with providerId", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const result = yield* acp.newSession("/tmp/my-project", "claude-code");
				expect(dispatched.map((command) => command.type)).toEqual([
					"project.create",
					"session.create",
				]);
				expect(dispatched[1]).toMatchObject({
					type: "session.create",
					providerId: "claude-code",
				});
				expect(result.sessionId.length).toBeGreaterThan(0);
			})
		));

	it("newSession reuses an existing project for a known cwd", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed({
								...emptyRpcSessionSnapshot(0),
								projects: [
									{
										projectId: "project-existing",
										title: "my-project",
										workspaceRoot: "/tmp/my-project",
										createdAt: "2024-01-01T00:00:00.000Z",
										updatedAt: "2024-01-01T00:00:00.000Z",
										deletedAt: null,
										sessionCount: 0,
										gitStatus: null,
									},
								],
							} as unknown as RpcSessionSnapshot),
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.newSession("/tmp/my-project");
				expect(dispatched.map((command) => command.type)).toEqual(["session.create"]);
				expect(dispatched[0]).toMatchObject({ projectId: "project-existing" });
			})
		));

	it("setModel dispatches session.set-model", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.setModel("session-1", "claude-opus-4-6");
				expect(dispatched[0]).toMatchObject({
					type: "session.set-model",
					sessionId: "session-1",
					modelId: "claude-opus-4-6",
				});
			})
		));

	it("replyInteraction maps a permission reply to interaction.reply", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.replyInteraction({
					sessionId: "session-1",
					interactionId: "approval-1",
					replyHandler: { kind: "json-rpc", requestId: 1 },
					payload: { kind: "permission", reply: "once", optionId: "opt-1" },
				});
				expect(dispatched[0]).toMatchObject({
					type: "interaction.reply",
					sessionId: "session-1",
					approvalRequestId: "approval-1",
					decision: "allow",
				});
			})
		));

	it("replyInteraction maps a rejected permission reply to deny", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.replyInteraction({
					sessionId: "session-1",
					interactionId: "approval-1",
					replyHandler: { kind: "json-rpc", requestId: 1 },
					payload: { kind: "permission", reply: "reject", optionId: "opt-1" },
				});
				expect(dispatched[0]).toMatchObject({ decision: "deny" });
			})
		));

	it("replyInteraction fails honestly for a question reply (no wire representation)", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(
					acp.replyInteraction({
						sessionId: "session-1",
						interactionId: "q-1",
						replyHandler: { kind: "json-rpc", requestId: 1 },
						payload: { kind: "question", answers: [], answerMap: {} },
					})
				);
				expect(Result.isFailure(result)).toBe(true);
			})
		));

	it("respondInboundRequest dispatches inbound.respond with a stringified body", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.respondInboundRequest("session-1", 7, { ok: true });
				expect(dispatched[0]).toMatchObject({
					type: "inbound.respond",
					sessionId: "session-1",
					requestId: "7",
					body: JSON.stringify({ ok: true }),
				});
			})
		));

	it("archiveSession dispatches session.archive", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.archiveSession("session-1");
				expect(dispatched.map((command) => command.type)).toEqual(["session.archive"]);
				expect(dispatched[0]).toMatchObject({ sessionId: "session-1" });
			})
		));

	it("unarchiveSession dispatches session.unarchive", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.unarchiveSession("session-1");
				expect(dispatched.map((command) => command.type)).toEqual(["session.unarchive"]);
			})
		));

	it("closeSession dispatches session.close", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.closeSession("session-1");
				expect(dispatched.map((command) => command.type)).toEqual(["session.close"]);
			})
		));

	it("getSessionConnectionReadiness derives a ready lifecycle from the snapshot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withSession(emptyRpcSessionSnapshot(0), {
									sessionId,
									projectId: "project-1" as never,
									title: "t" as never,
									provider: null,
									createdAt: "2024-01-01T00:00:00.000Z" as never,
									updatedAt: "2024-01-01T00:00:00.000Z" as never,
									lastActivityAt: "2024-01-01T00:00:00.000Z" as never,
									archivedAt: null,
									deletedAt: null,
									prNumber: null,
									prLinkMode: null,
									providerSessionId: null,
									providerSessionFailed: false,
								})
							),
					})
				);
				const readiness = yield* acp.getSessionConnectionReadiness("session-1");
				expect(readiness.lifecycle.status).toBe("ready");
			})
		));

	it("getSessionConnectionReadiness reports archived when the snapshot has archivedAt set", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withSession(emptyRpcSessionSnapshot(0), {
									sessionId,
									projectId: "project-1" as never,
									title: "t" as never,
									provider: null,
									createdAt: "2024-01-01T00:00:00.000Z" as never,
									updatedAt: "2024-01-01T00:00:00.000Z" as never,
									lastActivityAt: "2024-01-01T00:00:00.000Z" as never,
									archivedAt: "2024-01-02T00:00:00.000Z" as never,
									deletedAt: null,
									prNumber: null,
									prLinkMode: null,
									providerSessionId: null,
									providerSessionFailed: false,
								})
							),
					})
				);
				const readiness = yield* acp.getSessionConnectionReadiness("session-1");
				expect(readiness.lifecycle.status).toBe("archived");
			})
		));

	it("forkSession, rpcCall, and getEventBridgeInfo are honestly unsupported", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const forkResult = yield* Effect.result(acp.forkSession("session-1", "/tmp"));
				const rpcCallResult = yield* Effect.result(acp.rpcCall("session/foo", {}));
				const eventBridgeResult = yield* Effect.result(acp.getEventBridgeInfo());
				expect(Result.isFailure(forkResult)).toBe(true);
				expect(Result.isFailure(rpcCallResult)).toBe(true);
				expect(Result.isFailure(eventBridgeResult)).toBe(true);
			})
		));

	it("installAgent sends agentCall's agent.install op and returns the re-read agent list", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requests: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						agentCall: (request) => {
							requests.push(request as unknown as Record<string, unknown>);
							return Effect.succeed({
								op: "agent.install",
								agentId: "opencode",
								version: "1.18.25",
								agents: [
									{
										id: "opencode",
										name: "OpenCode",
										availabilityKind: { kind: "installable", installed: true },
										signIn: { kind: "browser" },
									},
								],
							});
						},
					})
				);
				const result = yield* acp.installAgent("opencode");
				expect(requests).toEqual([{ op: "agent.install", agentId: "opencode" }]);
				expect(result).toEqual({
					version: "1.18.25",
					agents: [
						{
							id: "opencode",
							name: "OpenCode",
							availability_kind: { kind: "installable", installed: true },
							sign_in: { kind: "browser" },
						},
					],
				});
			})
		));

	it("uninstallAgent sends agentCall's agent.uninstall op and returns the re-read agent list", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requests: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						agentCall: (request) => {
							requests.push(request as unknown as Record<string, unknown>);
							return Effect.succeed({
								op: "agent.uninstall",
								agentId: "opencode",
								agents: [
									{
										id: "opencode",
										name: "OpenCode",
										availabilityKind: { kind: "installable", installed: false },
										signIn: { kind: "browser" },
									},
								],
							});
						},
					})
				);
				const agents = yield* acp.uninstallAgent("opencode");
				expect(requests).toEqual([{ op: "agent.uninstall", agentId: "opencode" }]);
				expect(agents).toEqual([
					{
						id: "opencode",
						name: "OpenCode",
						availability_kind: { kind: "installable", installed: false },
						sign_in: { kind: "browser" },
					},
				]);
			})
		));

	// The bug this replaces: authenticateAgent answered unsupportedOnContract,
	// so the panel's sign-in button could only ever fail. It has to reach the
	// backend's sign-in op instead.
	it("authenticateAgent sends agentCall's agent.authenticate op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requests: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						agentCall: (request) => {
							requests.push(request as unknown as Record<string, unknown>);
							return Effect.succeed({
								op: "agent.authenticate",
								agentId: "codex",
								agents: [
									{
										id: "codex",
										name: "Codex",
										availabilityKind: { kind: "installable", installed: true },
										signIn: { kind: "browser" },
									},
								],
							});
						},
					})
				);
				// The agent list comes back from the sign-in call itself, read
				// on the backend after the login command exited.
				const agents = yield* acp.authenticateAgent("codex");
				expect(requests).toEqual([{ op: "agent.authenticate", agentId: "codex" }]);
				expect(agents.map((agent) => agent.id)).toEqual(["codex"]);
			})
		));

	it("authenticateAgent carries the backend's own reason for a failed sign-in", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						agentCall: () =>
							Effect.fail(
								new RpcAgentCallError({
									op: "agent.authenticate",
									detail: "The codex sign-in ended without signing you in.",
								})
							),
					})
				);
				const outcome = yield* Effect.result(acp.authenticateAgent("codex"));
				expect(Result.isFailure(outcome)).toBe(true);
				if (Result.isFailure(outcome)) {
					// The facade wraps every failure in a generic "Agent
					// operation failed" line, so the backend's own reason lives
					// in the cause chain. The panel reads it with
					// rootCauseMessage; this asserts it survives the trip.
					expect(rootCauseMessage(outcome.failure)).toContain("without signing you in");
					expect(rootCauseMessage(outcome.failure)).not.toContain("unsupported");
				}
			})
		));

	it("cancelAgentAuthentication sends agentCall's cancel op and reports whether it stopped one", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requests: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						agentCall: (request) => {
							requests.push(request as unknown as Record<string, unknown>);
							return Effect.succeed({
								op: "agent.cancel-authentication",
								agentId: "codex",
								cancelled: true,
							});
						},
					})
				);
				const cancelled = yield* acp.cancelAgentAuthentication("codex");
				expect(requests).toEqual([{ op: "agent.cancel-authentication", agentId: "codex" }]);
				expect(cancelled).toBe(true);
			})
		));

	it("dies when the server answers an agentCall with the wrong op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						agentCall: () => Effect.succeed({ op: "agent.list", agents: [] }),
					})
				);
				const outcome = yield* Effect.result(
					acp.installAgent("opencode").pipe(Effect.catchCause(() => Effect.succeed("died")))
				);
				expect(Result.isSuccess(outcome)).toBe(true);
				if (Result.isSuccess(outcome)) {
					expect(outcome.success).toBe("died");
				}
			})
		));

	it("listAgents maps agentCall's agent.list result onto AgentInfo", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						agentCall: () =>
							Effect.succeed({
								op: "agent.list",
								agents: [
									{
										id: "claude-code",
										name: "Claude Code",
										availabilityKind: { kind: "installable", installed: true },
										signIn: { kind: "browser" },
									},
								],
							}),
					})
				);
				const agents = yield* acp.listAgents();
				expect(agents).toEqual([
					{
						id: "claude-code",
						name: "Claude Code",
						availability_kind: { kind: "installable", installed: true },
						sign_in: { kind: "browser" },
					},
				]);
			})
		));

	it("initialize is a genuine no-op (no dispatch, no failure)", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<Record<string, unknown>> = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command as unknown as Record<string, unknown>);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* acp.initialize();
				expect(dispatched).toHaveLength(0);
			})
		));
});
