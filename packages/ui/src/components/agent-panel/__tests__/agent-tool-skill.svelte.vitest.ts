import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolSkill from "../agent-tool-skill.svelte";

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

describe("AgentToolSkill", () => {
	it("renders completed skills with compact edit-style header chrome", () => {
		const view = render(AgentToolSkill, {
			props: {
				skillName: "diagnose",
				description: "Diagnose hard bugs.",
				status: "done",
			},
		});

		expect(view.getByText("/diagnose")).toBeTruthy();
		expect(view.queryByText("Successful")).toBeNull();
		expect(view.getByLabelText("Successful")).toBeTruthy();
		expect(view.container.querySelector(".h-6")).toBeTruthy();
		expect(view.getByTestId("tool-kind-icon-skill")).toBeTruthy();
		expect(view.container.querySelector(".text-success")).toBeTruthy();
	});
});
