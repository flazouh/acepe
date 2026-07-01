import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import GitPrHeader from "../git-viewer/git-pr-header.svelte";
import type { GitPrData } from "../git-viewer/types.js";
import MergeButton from "./merge-button.svelte";

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

describe("MergeButton rounded icon", () => {
	it("renders the merged state with the rounded PR-merged icon", () => {
		const { container, getByText } = render(MergeButton, {
			props: {
				mergeState: "merged",
			},
		});

		expect(getByText("Merged")).toBeTruthy();
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-[11px]");
	});

	it("renders merged PR headers with the rounded PR-merged icon", () => {
		const pr: GitPrData = {
			number: 42,
			title: "Land rounded icons",
			author: "alex",
			state: "merged",
			files: [],
		};

		const { container, getByText } = render(GitPrHeader, {
			props: { pr },
		});

		expect(getByText("Merged")).toBeTruthy();
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
	});
});
