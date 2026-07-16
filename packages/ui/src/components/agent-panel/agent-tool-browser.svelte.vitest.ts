import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolBrowser from "./agent-tool-browser.svelte";

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

const longScript =
	"(() => {\n  const eds = Array.from(document.querySelectorAll('[data-ref]'));\n  return eds.map((el) => el.textContent?.trim() ?? '');\n})()";

describe("AgentToolBrowser", () => {
	it("keeps the title row free of script or result text", () => {
		const view = render(AgentToolBrowser, {
			props: {
				title: "Browser",
				detailsText: longScript,
				status: "running",
			},
		});

		const header = view.getByTestId("browser-tool-header");
		expect(header.textContent).toContain("Browser");
		expect(header.textContent).not.toContain("const eds");
		expect(header.textContent).not.toContain("querySelectorAll");
	});

	it("renders the script in an execute-style body with line numbers", () => {
		const view = render(AgentToolBrowser, {
			props: {
				title: "Browser",
				scriptText: longScript,
				status: "running",
			},
		});

		const header = view.getByTestId("browser-tool-header");
		expect(header.textContent).toContain("Browser");
		expect(header.textContent).not.toContain("const eds");

		const body = view.getByTestId("browser-script-body");
		expect(body.textContent).toContain("const eds");
		expect(body.textContent).toContain("1");
		expect(body.querySelectorAll(".browser-block").length).toBeGreaterThan(1);
	});

	it("promotes a misplaced code subtitle into the script body", () => {
		const view = render(AgentToolBrowser, {
			props: {
				title: "Browser",
				subtitle: longScript,
				status: "running",
			},
		});

		const header = view.getByTestId("browser-tool-header");
		expect(header.textContent).not.toContain("const eds");
		expect(view.getByTestId("browser-script-body").textContent).toContain("const eds");
	});

	it("renders highlighted script html from the highlightScript callback", () => {
		const view = render(AgentToolBrowser, {
			props: {
				title: "Browser",
				scriptText: "(() => document.body)",
				status: "done",
				highlightScript: (code: string) =>
					`<span class="line"><span style="color: var(--shiki-light)">${code}</span></span>`,
			},
		});

		const body = view.getByTestId("browser-script-body");
		expect(body.querySelector(".browser-block-shiki")?.innerHTML).toContain("--shiki-light");
		expect(body.textContent).toContain("document.body");
		expect(body.querySelectorAll(".browser-line-number").length).toBe(0);
	});

	it("keeps plain line-number fallback when highlightScript returns null", () => {
		const view = render(AgentToolBrowser, {
			props: {
				title: "Browser",
				scriptText: "const x = 1;\nconst y = 2;",
				status: "done",
				highlightScript: () => null,
			},
		});

		const body = view.getByTestId("browser-script-body");
		expect(body.querySelector(".browser-block-shiki")).toBeNull();
		expect(body.querySelectorAll(".browser-line-number").length).toBe(2);
	});
});
