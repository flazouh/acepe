import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

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

describe("acp tauri client", () => {
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

	it("installAgent and uninstallAgent are honestly unsupported", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const installResult = yield* Effect.result(acp.installAgent("claude-code"));
				const uninstallResult = yield* Effect.result(acp.uninstallAgent("claude-code"));
				expect(Result.isFailure(installResult)).toBe(true);
				expect(Result.isFailure(uninstallResult)).toBe(true);
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
