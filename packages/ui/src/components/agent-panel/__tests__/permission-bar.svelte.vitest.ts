import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelPermissionBarActions from "../permission-bar-actions.svelte";
import PermissionBarSummaryFixture from "./fixtures/permission-bar-summary-fixture.svelte";

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

afterEach(() => {
	cleanup();
});

describe("AgentPanelPermissionBar", () => {
	/**
	 * This branch runs when the tool call above already names the file or
	 * command, and the working row below already says "Waiting for your
	 * approval". Printing "Permission required" between them was the same
	 * sentence a third time, so the icon carries it as its accessible name and
	 * the actions speak for themselves.
	 */
	it("shows the actions without repeating what the rows around it already say", () => {
		const view = render(PermissionBarSummaryFixture, {
			props: {
				showSummary: false,
			},
		});

		expect(view.queryByText("Permission required")).toBeNull();
		expect(view.getByLabelText("Permission required")).toBeTruthy();
		expect(view.getByTestId("permission-actions")).toBeTruthy();
		expect(view.queryByText("src/file.ts")).toBeNull();
	});

	it("renders the tool-call attachment as a bottom cap", () => {
		const view = render(PermissionBarSummaryFixture, {
			props: {
				attachment: "tool-call",
				showSummary: false,
			},
		});

		const permissionCard = view.container.querySelector(".permission-card-enter");

		expect(view.queryByText("Permission required")).toBeNull();
		expect(permissionCard?.parentElement?.className).toContain("permission-attached-shell");
		expect(permissionCard?.parentElement?.className).not.toContain("mt-[-1px]");
		expect(permissionCard?.className).toContain("permission-attached-card");
		expect(permissionCard?.className).toContain("inline-flex");
		expect(permissionCard?.className).toContain("bg-input/50");
		expect(permissionCard?.className).toContain("overflow-hidden");
		expect(permissionCard?.className).toContain("px-2");
		expect(permissionCard?.className).toContain("py-1");
		expect(permissionCard?.className).toContain("rounded-b-lg");
		expect(permissionCard?.className).toContain("rounded-t-none");
		expect(permissionCard?.className).not.toContain("permission-attached-inverted-radius");
	});
});

describe("AgentPanelPermissionBarActions", () => {
	it("hides permission buttons after a reply has been selected", () => {
		const view = render(AgentPanelPermissionBarActions, {
			props: {
				selectedReply: "once",
				onAllow: vi.fn(),
				onAlwaysAllow: vi.fn(),
				onDeny: vi.fn(),
				showAlwaysAllow: true,
			},
		});

		expect(view.queryByText("Allow")).toBeNull();
		expect(view.queryByText("Always allow")).toBeNull();
		expect(view.queryByText("Deny")).toBeNull();
	});
});
