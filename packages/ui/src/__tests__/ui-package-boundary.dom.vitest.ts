import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CheckpointCard from "../components/checkpoint/checkpoint-card.svelte";
import TracerTranscript from "../components/tracer-transcript/tracer-transcript.svelte";
import UiPackageBoundarySidebarFixture from "./fixtures/ui-package-boundary-sidebar-fixture.svelte";
import type { CheckpointData } from "../components/checkpoint/types.js";

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

const mockCheckpoint: CheckpointData = {
	id: "cp-1",
	number: 1,
	message: "Initial snapshot",
	timestamp: 1_700_000_000_000,
	fileCount: 2,
	totalInsertions: 10,
	totalDeletions: 3,
	isAuto: false,
};

describe("ui package boundary render smoke", () => {
	it("renders CheckpointCard from props without store or Tauri", () => {
		const view = render(CheckpointCard, {
			props: {
				checkpoint: mockCheckpoint,
				isExpanded: false,
				showRevertButton: false,
			},
		});

		expect(view.getByText("Initial snapshot")).toBeTruthy();
	});

	it("renders AppSidebarLayout from snippet props only", () => {
		const view = render(UiPackageBoundarySidebarFixture);

		expect(view.getByText("v0.0.0-test")).toBeTruthy();
		expect(view.getByTestId("boundary-session-list")).toBeTruthy();
	});

	it("renders TracerTranscript from row props without store or Tauri", () => {
		const view = render(TracerTranscript, {
			props: {
				rows: [{ key: "user", role: "user", text: "Ping" }],
				emptyLabel: "No messages",
			},
		});

		expect(view.getByTestId("tracer-transcript")).toBeTruthy();
		expect(view.getByText("Ping")).toBeTruthy();
	});
});
