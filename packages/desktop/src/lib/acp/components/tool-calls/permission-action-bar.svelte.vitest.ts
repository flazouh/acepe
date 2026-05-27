import { cleanup, render } from "@testing-library/svelte";
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
});
