import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const { default: MultiProjectGroupLabel } = await import("../multi-project-group-label.svelte");

afterEach(() => {
	cleanup();
});

describe("MultiProjectGroupLabel", () => {
	it("renders a lightweight project identity row for non-agent groups", () => {
		const view = render(MultiProjectGroupLabel, {
			projectName: "alpha",
			projectColor: "#FF5D5A",
		});

		expect(view.getByText("Alpha")).not.toBeNull();
	});
});
