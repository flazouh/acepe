import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentToolRead from "../agent-tool-read.svelte";

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

let storedValues = new Map<string, string>();

const memoryStorage: Storage = {
	get length() {
		return storedValues.size;
	},
	clear() {
		storedValues = new Map<string, string>();
	},
	getItem(key: string) {
		return storedValues.get(key) ?? null;
	},
	key(index: number) {
		return Array.from(storedValues.keys())[index] ?? null;
	},
	removeItem(key: string) {
		storedValues.delete(key);
	},
	setItem(key: string, value: string) {
		storedValues.set(key, value);
	},
};

beforeEach(() => {
	storedValues = new Map<string, string>();
	vi.stubGlobal("localStorage", memoryStorage);
});

afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
});

describe("AgentToolRead", () => {
	it("renders read file content in the tool body when expanded", () => {
		storedValues.set("acepe:agent-tool-read-expanded:/repo/src/app.ts", "true");
		const view = render(AgentToolRead, {
			filePath: "/repo/src/app.ts",
			sourceRangeLabel: "Lines 1-2",
			sourceExcerpt: "const answer = 42;\nexport { answer };",
			status: "done",
		});

		expect(view.container.querySelector(".agent-tool-card")).toBeNull();
		expect(view.getByTestId("agent-tool-read")).toBeTruthy();
		expect(view.getByTestId("tool-kind-icon-read")).toBeTruthy();
		expect(view.getByText("Read")).toBeTruthy();
		expect(view.getByText("Lines 1-2")).toBeTruthy();
		expect(view.container.querySelector("pre")?.textContent).toBe(
			"const answer = 42;\nexport { answer };"
		);
	});

	it("renders highlighted read file content when provided and expanded", () => {
		storedValues.set("acepe:agent-tool-read-expanded:/repo/src/app.ts", "true");
		const view = render(AgentToolRead, {
			filePath: "/repo/src/app.ts",
			sourceExcerpt: "const answer = 42;",
			sourceExcerptHtml: '<span style="color: var(--shiki-light)">const</span> answer = 42;',
			status: "done",
		});

		const highlightedToken = view.container.querySelector("pre code span");
		expect(highlightedToken?.textContent).toBe("const");
		expect(view.container.querySelector("pre")?.textContent).toBe("const answer = 42;");
	});

	it("keeps highlighted Shiki read content text exact when expanded", () => {
		storedValues.set(
			"acepe:agent-tool-read-expanded:/repo/src/review-file-key.ts",
			"true"
		);
		const view = render(AgentToolRead, {
			filePath: "/repo/src/review-file-key.ts",
			sourceExcerpt: 'import type { ModifiedFileEntry } from "../types/modified-file-entry.js";\n\ntype ReviewFileSnapshot = Pick<',
			sourceExcerptHtml:
				'<span class="line"><span style="color: var(--shiki-light)">import</span> type { ModifiedFileEntry } from "../types/modified-file-entry.js";</span>\n<span class="line"></span>\n<span class="line"><span style="color: var(--shiki-light)">type</span> ReviewFileSnapshot = Pick&lt;</span>',
			status: "done",
		});

		expect(view.container.querySelector("pre")?.textContent).toBe(
			'import type { ModifiedFileEntry } from "../types/modified-file-entry.js";\n\ntype ReviewFileSnapshot = Pick<'
		);
	});

	it("hides read file content body by default (collapsed)", () => {
		const view = render(AgentToolRead, {
			filePath: "/repo/src/app.ts",
			sourceRangeLabel: "Lines 1-2",
			sourceExcerpt: "const answer = 42;",
			status: "done",
		});

		expect(view.container.querySelector("pre")).toBeNull();
		expect(
			view.getByRole("button", { name: "Expand read content" }).getAttribute("aria-expanded")
		).toBe("false");
	});

	it("defers source highlighting until the read content is expanded", async () => {
		const highlightSource = vi.fn(
			() => '<span style="color: var(--shiki-light)">const</span> answer = 42;'
		);
		const view = render(AgentToolRead, {
			filePath: "/repo/src/app.ts",
			sourceExcerpt: "const answer = 42;",
			highlightSource,
			status: "done",
		});

		expect(highlightSource).not.toHaveBeenCalled();

		await fireEvent.click(view.getByRole("button", { name: "Expand read content" }));

		expect(highlightSource).toHaveBeenCalledOnce();
		expect(highlightSource).toHaveBeenCalledWith("const answer = 42;", "/repo/src/app.ts");
		expect(view.container.querySelector("pre code span")?.textContent).toBe("const");
	});

	it("calls onSelect when the interactive file badge is clicked", async () => {
		const onSelect = vi.fn();
		const view = render(AgentToolRead, {
			filePath: "/repo/src/app.ts",
			sourceExcerpt: "const answer = 42;",
			status: "done",
			interactive: true,
			onSelect,
		});

		await fireEvent.click(view.getByRole("button", { name: "app.ts" }));

		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("persists expanded read content by tool id", async () => {
		const firstView = render(AgentToolRead, {
			toolCallId: "tool-read-1",
			filePath: "/repo/src/app.ts",
			sourceExcerpt: "line 1\nline 2",
			status: "done",
		});

		const toggle = firstView.getByRole("button", { name: "Expand read content" });
		await fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		firstView.unmount();

		const secondView = render(AgentToolRead, {
			toolCallId: "tool-read-1",
			filePath: "/repo/src/app.ts",
			sourceExcerpt: "line 1\nline 2",
			status: "done",
		});

		expect(
			secondView.getByRole("button", { name: "Collapse read content" }).getAttribute("aria-expanded")
		).toBe("true");
	});
});
