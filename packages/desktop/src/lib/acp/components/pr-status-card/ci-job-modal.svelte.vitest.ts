import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CiJobModal from "./ci-job-modal.svelte";

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

vi.mock("@acepe/ui", async () => {
	const Stub = (await import("./test-component-stub.svelte")).default;
	const HugeiconsIconStub = (await import("./test-hugeicons-icon-stub.svelte")).default;

	return {
		HugeiconsIcon: HugeiconsIconStub,
		LoadingIcon: Stub,
		WrenchIcon: Stub,
	};
});

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("$lib/components/ui/dialog-frame.svelte", async () => {
	const DialogFrameStub = (await import("./test-dialog-frame-stub.svelte")).default;

	return {
		default: DialogFrameStub,
	};
});

afterEach(() => {
	cleanup();
});

describe("CiJobModal Hugeicons wiring", () => {
	it("renders the GitHub action with the open-in-new-window icon", () => {
		const view = render(CiJobModal, {
			open: true,
			check: {
				name: "CI",
				status: "COMPLETED",
				conclusion: "FAILURE",
				detailsUrl: "https://github.com/flazouh/acepe/actions/runs/1",
				startedAt: null,
				completedAt: null,
				workflowName: "CI",
			},
			job: {
				id: 1,
				name: "CI",
				status: "completed",
				conclusion: "failure",
				steps: [],
			},
			isLoading: false,
			projectPath: "/repo",
			onClose: vi.fn(),
			onFix: vi.fn(),
		});

		const icon = view.getByTestId("ci-job-modal-open-external-hugeicons-icon");
		expect(icon.getAttribute("data-hugeicons-icon-name")).toBe("open-in-new-window");
	});
});
