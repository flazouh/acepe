import { emptyRpcSessionSnapshot, type RpcClient } from "@acepe/contracts";
import { loadingIconPreference } from "@acepe/ui/icons";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { setAppRpcClientForTest } from "$lib/rpc/app-client.js";

import { loadingIndicatorSettingsStore } from "./loading-indicator-settings-store.svelte.js";

const inertClient: RpcClient = {
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	events: () => Stream.empty,
	getProjectIndex: () => Effect.succeed({ projectPath: "/repo", files: [], directories: [] }),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () => Effect.succeed({ sessionId: "s" }),
} as unknown as RpcClient;

describe("loading indicator colour", () => {
	// The store used to set only its own field, so a picked colour persisted
	// across restarts and never reached a spinner: every loading icon reads
	// loadingIconPreference, and nothing was writing it.
	it("hands the picked colour to the preference every icon reads", async () => {
		setAppRpcClientForTest(inertClient);

		await loadingIndicatorSettingsStore.setColor("violet");

		expect(loadingIndicatorSettingsStore.selectedColor).toBe("violet");
		expect(loadingIconPreference.colorId).toBe("violet");
	});
});
