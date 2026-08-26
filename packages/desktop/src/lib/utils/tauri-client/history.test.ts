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
import { history } from "./history.ts";

describe("history tauri client", () => {
	it("fails auditSessionLoadTiming as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(history.auditSessionLoadTiming("session-1", "/tmp/acepe", "claude-code"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails discoverAllProjectsWithSessions as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(history.discoverAllProjectsWithSessions())
		);
		expect(Result.isFailure(result)).toBe(true);
	});
});

describe("history.getStartupSessions alias resolution", () => {
	const diskSession = {
		id: "claude-uuid-42",
		title: "Existing on-disk session",
		provider: "claude" as const,
		projectPath: "/tmp/acepe",
		createdAtMs: 1_000,
		updatedAtMs: 2_000,
		sourcePath: "/tmp/acepe/.claude/claude-uuid-42.jsonl",
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
		getProjectIndex: () =>
			Effect.succeed({
				projectPath: "/tmp/acepe",
				files: [],
				gitStatus: [],
				totalFiles: 0,
				totalLines: 0,
			}),
		invalidateProjectIndex: () => Effect.void,
		readTextFile: () => Effect.succeed(""),
		writeTextFile: () => Effect.void,
		getDefaultShell: () => Effect.succeed("/bin/zsh"),
		gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
		agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
		getProviderAccountUsage: () => Effect.succeed([]),
		listProviderSessions: () => Effect.succeed([]),
		listProviderProjects: () => Effect.succeed([]),
		importProviderSession: () =>
			Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
		events: () => Stream.empty,
		...overrides,
	});

	afterEach(() => {
		setAppRpcClientForTest(null);
	});

	it("returns a direct entry with no alias when the requested id matches a discovered session", async () => {
		setAppRpcClientForTest(
			makeClient({
				listProviderProjects: () =>
					Effect.succeed([
						{ projectPath: "/tmp/acepe", provider: "claude", sessionCount: 1, lastActiveMs: 2_000 },
					]),
				listProviderSessions: () => Effect.succeed([diskSession]),
			})
		);
		const response = await Effect.runPromise(history.getStartupSessions(["claude-uuid-42"]));
		expect(response.entries).toHaveLength(1);
		expect(response.entries[0]?.id).toBe("claude-uuid-42");
		expect(response.aliasRemaps).toEqual({});
	});

	it("resolves an orchestration session id to its disk-scanned row via providerSessionId", async () => {
		setAppRpcClientForTest(
			makeClient({
				listProviderProjects: () =>
					Effect.succeed([
						{ projectPath: "/tmp/acepe", provider: "claude", sessionCount: 1, lastActiveMs: 2_000 },
					]),
				listProviderSessions: () => Effect.succeed([diskSession]),
				snapshot: (request) => {
					if (
						"kind" in request &&
						request.kind === "session" &&
						request.sessionId === "session-orchestration-1"
					) {
						return Effect.succeed(
							withSession(emptyRpcSessionSnapshot(0), {
								sessionId: SessionId.make("session-orchestration-1"),
								projectId: "project-1" as never,
								title: "t" as never,
								provider: "claude-code",
								createdAt: "2024-01-01T00:00:00.000Z" as never,
								updatedAt: "2024-01-01T00:00:00.000Z" as never,
								lastActivityAt: "2024-01-01T00:00:00.000Z" as never,
								archivedAt: null,
								deletedAt: null,
								prNumber: null,
								prLinkMode: null,
								providerSessionId: "claude-uuid-42",
								providerSessionFailed: false,
							})
						);
					}
					return Effect.succeed(emptyRpcSessionSnapshot(0));
				},
			})
		);
		const response = await Effect.runPromise(
			history.getStartupSessions(["session-orchestration-1"])
		);
		expect(response.entries).toHaveLength(1);
		expect(response.entries[0]?.id).toBe("claude-uuid-42");
		expect(response.aliasRemaps).toEqual({ "session-orchestration-1": "claude-uuid-42" });
	});

	it("reports no alias when the orchestration session's providerSessionId has no matching disk row", async () => {
		setAppRpcClientForTest(
			makeClient({
				listProviderProjects: () => Effect.succeed([]),
				listProviderSessions: () => Effect.succeed([]),
				snapshot: () =>
					Effect.succeed(
						withSession(emptyRpcSessionSnapshot(0), {
							sessionId: SessionId.make("session-orchestration-1"),
							projectId: "project-1" as never,
							title: "t" as never,
							provider: "claude-code",
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
		const response = await Effect.runPromise(
			history.getStartupSessions(["session-orchestration-1"])
		);
		expect(response.entries).toHaveLength(0);
		expect(response.aliasRemaps).toEqual({});
	});
});
