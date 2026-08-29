import {
	emptyRpcSessionSnapshot,
	type GitCallRequest,
	type GitCallResult,
	type RpcClient,
	type RpcClientError,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/**
 * A whole RpcClient whose only live method is `gitCall`.
 *
 * Tests that drive a gitCall-backed facade (tauri-client/git.ts, and the
 * github-service that sits on top of it) need a complete RpcClient to hand
 * to setAppRpcClientForTest, but care about exactly one method. Everything
 * else answers with an inert value so a stray call fails an assertion
 * rather than the test setup.
 */
export const makeGitCallRpcClient = (
	gitCall: (request: GitCallRequest) => Effect.Effect<GitCallResult, RpcClientError>
): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () =>
		Effect.succeed({
			projectPath: "/tmp/p",
			files: [],
			gitStatus: [],
			totalFiles: 0,
			totalLines: 0,
		}),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall,
	agentCall: () => Effect.succeed({ op: "agent.list", agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () =>
		Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
});
