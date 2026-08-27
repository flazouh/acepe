import { expect, it } from "bun:test";
import { type RpcClient, SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { appRpcClient, setAppRpcClientForTest } from "./app-client.ts";

const fake: RpcClient = {
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.die("unused"),
	getProjectIndex: () => Effect.die("unused"),
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
};

it("returns the injected client and memoises it", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			setAppRpcClientForTest(fake);
			const first = yield* appRpcClient();
			const second = yield* appRpcClient();
			expect(first).toBe(fake);
			expect(second).toBe(first);
			setAppRpcClientForTest(null);
		})
	));
