import { cleanup, fireEvent, render } from "@testing-library/svelte";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PermissionRequest } from "../../types/permission.js";

const mockPermissionStore = vi.hoisted(() => ({
	getReplyInFlight: vi.fn(),
	reply: vi.fn(),
}));

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("../../store/permission-store.svelte.js", () => ({
	getPermissionStore: () => mockPermissionStore,
	// The real implementation, not a mock: this is the seam the AC-280 test
	// below exists to prove callers go through -- it must actually run the
	// Effect `mockPermissionStore.reply()` returns, the way the production
	// helper does, or the test can't tell "called and discarded" apart from
	// "called and executed".
	runPermissionReply: (store: typeof mockPermissionStore, permissionId: string, reply: string) => {
		Effect.runFork(store.reply(permissionId, reply));
	},
}));

import PermissionActionBar from "./permission-action-bar.svelte";

function createPermission(): PermissionRequest {
	return {
		id: "permission-1",
		sessionId: "session-1",
		permission: "Execute",
		patterns: [],
		metadata: { options: [] },
		always: [],
	};
}

afterEach(() => {
	cleanup();
	mockPermissionStore.getReplyInFlight.mockReset();
	mockPermissionStore.reply.mockReset();
});

describe("PermissionActionBar", () => {
	it("hides permission buttons after a reply has been selected", () => {
		mockPermissionStore.getReplyInFlight.mockReturnValue("once");

		const view = render(PermissionActionBar, {
			props: {
				permission: createPermission(),
			},
		});

		expect(view.queryByText("Allow")).toBeNull();
		expect(view.queryByText("Always")).toBeNull();
		expect(view.queryByText("Deny")).toBeNull();
	});

	// AC-280: `PermissionStore.reply()` returns a lazy Effect -- calling it
	// describes the reply, it does not send it. Every button here used to
	// call `permissionStore.reply(id, choice)` and discard the return value,
	// so clicking Allow never ran the Effect that actually dispatches the
	// reply to the server: the button visibly went away (reply() marks
	// repliesInFlight synchronously, before the Effect it returns even
	// starts) while the agent's turn stayed blocked forever. Reproduced live
	// (zero InteractionReplied events, zero interaction.reply command
	// receipts, even though the button disappeared right after the click).
	// This asserts the returned Effect is actually EXECUTED, not merely
	// constructed.
	it("actually runs the reply Effect when Allow is clicked, not just constructs it", async () => {
		let ran = false;
		mockPermissionStore.getReplyInFlight.mockReturnValue(null);
		mockPermissionStore.reply.mockReturnValue(
			Effect.sync(() => {
				ran = true;
			})
		);

		const view = render(PermissionActionBar, {
			props: {
				permission: createPermission(),
			},
		});

		await fireEvent.click(view.getByText("Allow"));

		expect(mockPermissionStore.reply).toHaveBeenCalledWith("permission-1", "once");
		expect(ran).toBe(true);
	});
});
