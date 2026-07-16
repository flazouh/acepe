import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { createRawSnippet, type Snippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

import AgentInputAgentSelector from "./agent-input-agent-selector.svelte";
import type {
	AgentInputAgentSelectorIconParams,
	AgentInputAgentSelectorItem,
} from "./agent-input-agent-selector-types.js";
import { resolveHugeiconsIcon } from "../icons/index.js";

// Sorted join of every path `d` value in a Hugeicons glyph definition.
function iconPathSignature(icon: ReturnType<typeof resolveHugeiconsIcon>): string {
	const ds: string[] = [];
	for (const entry of icon) {
		const d = entry[1].d;
		if (typeof d === "string") {
			ds.push(d);
		}
	}
	return ds.slice().sort().join("|");
}

// Sorted join of the DISTINCT path `d` values rendered inside a DOM element.
// The default pin stacks two identical pin glyphs (outline + filled) for the
// icon-swap, so the signature dedupes to stay comparable to a single glyph.
function domPathSignature(element: Element): string {
	const ds = new Set<string>();
	for (const path of Array.from(element.querySelectorAll("path"))) {
		const d = path.getAttribute("d");
		if (d) {
			ds.add(d);
		}
	}
	return Array.from(ds).sort().join("|");
}

// The glyph HugeiconsIcon falls back to when a name is not in the registry.
const FALLBACK_SIGNATURE = iconPathSignature(
	resolveHugeiconsIcon("__unmapped-icon-name__"),
);
const PIN_SIGNATURE = iconPathSignature(resolveHugeiconsIcon("pin"));

afterEach(() => {
	cleanup();
});

const renderAgentIcon: Snippet<[AgentInputAgentSelectorIconParams]> =
	createRawSnippet<[AgentInputAgentSelectorIconParams]>(() => ({
		render: () => `<span data-testid="agent-icon"></span>`,
	}));

const installedAgent: AgentInputAgentSelectorItem = {
	id: "claude",
	name: "Claude Code",
	installed: true,
};

async function openMenu(): Promise<void> {
	await fireEvent.click(screen.getByRole("button", { name: /Claude Code/ }));
}

describe("AgentInputAgentSelector not-installed row", () => {
	it("installs (not selects) when a not-installed agent row is clicked and keeps the menu open", async () => {
		const onAgentChange = vi.fn();
		const onAgentInstall = vi.fn();

		render(AgentInputAgentSelector, {
			props: {
				availableAgents: [
					installedAgent,
					{ id: "codex", name: "Codex", installed: false },
				],
				currentAgentId: "claude",
				onAgentChange,
				onAgentInstall,
				showLabel: true,
				renderAgentIcon,
			},
		});

		await openMenu();

		const row = await screen.findByRole("menuitem", { name: /Codex/ });
		expect(row.textContent).toContain("Not installed");

		await fireEvent.click(row);

		expect(onAgentInstall).toHaveBeenCalledTimes(1);
		expect(onAgentInstall).toHaveBeenCalledWith("codex");
		expect(onAgentChange).not.toHaveBeenCalled();

		// Menu remains open: the row is still queryable after the install click.
		await waitFor(() => {
			expect(screen.getByRole("menuitem", { name: /Codex/ })).toBeTruthy();
		});
	});

	it("shows inline progress and ignores repeat clicks while an agent is installing", async () => {
		const onAgentChange = vi.fn();
		const onAgentInstall = vi.fn();

		render(AgentInputAgentSelector, {
			props: {
				availableAgents: [
					installedAgent,
					{
						id: "codex",
						name: "Codex",
						installed: false,
						installing: true,
						installProgress: 55,
					},
				],
				currentAgentId: "claude",
				onAgentChange,
				onAgentInstall,
				showLabel: true,
				renderAgentIcon,
			},
		});

		await openMenu();

		const row = await screen.findByRole("menuitem", { name: /Codex/ });
		expect(row.textContent).toContain("Installing");

		await fireEvent.click(row);

		expect(onAgentInstall).not.toHaveBeenCalled();
		expect(onAgentChange).not.toHaveBeenCalled();
	});

	it("shows a persistent setup error and retries without selecting the agent", async () => {
		const onAgentChange = vi.fn();
		const onAgentInstall = vi.fn();

		render(AgentInputAgentSelector, {
			props: {
				availableAgents: [
					installedAgent,
					{
						id: "codex",
						name: "Codex",
						installed: false,
						installError: "Model catalog failed to load. Click to retry.",
					},
				],
				currentAgentId: "claude",
				onAgentChange,
				onAgentInstall,
				showLabel: true,
				renderAgentIcon,
			},
		});

		await openMenu();

		const row = await screen.findByRole("menuitem", { name: /Codex/ });
		expect(row.textContent).toContain("Model catalog failed to load. Click to retry.");

		await fireEvent.click(row);

		expect(onAgentInstall).toHaveBeenCalledWith("codex");
		expect(onAgentChange).not.toHaveBeenCalled();
		expect(screen.getByRole("menuitem", { name: /Codex/ })).toBeTruthy();
	});
});

describe("AgentInputAgentSelector default-agent toggle icon", () => {
	const codexAgent: AgentInputAgentSelectorItem = {
		id: "codex",
		name: "Codex",
		installed: true,
	};

	function renderWithDefault(defaultAgentId: string | null) {
		render(AgentInputAgentSelector, {
			props: {
				availableAgents: [installedAgent, codexAgent],
				currentAgentId: "claude",
				defaultAgentId,
				onAgentChange: vi.fn(),
				onDefaultAgentToggle: vi.fn(),
				showLabel: true,
				renderAgentIcon,
			},
		});
	}

	it("renders the semantic default (pin) glyph — never the help fallback — in the unset state", async () => {
		renderWithDefault(null);
		await openMenu();

		const toggle = await screen.findByRole("button", {
			name: "Set Codex as default agent",
		});
		const signature = domPathSignature(toggle);

		expect(signature).toBe(PIN_SIGNATURE);
		expect(signature).not.toBe(FALLBACK_SIGNATURE);
	});

	it("renders the semantic default (pin) glyph — never the help fallback — in the set state", async () => {
		renderWithDefault("codex");
		await openMenu();

		const toggle = await screen.findByRole("button", {
			name: "Unset Codex as default agent",
		});
		const signature = domPathSignature(toggle);

		expect(signature).toBe(PIN_SIGNATURE);
		expect(signature).not.toBe(FALLBACK_SIGNATURE);
	});

	it("keeps a non-default pin visible and outlined at rest with a stacked filled layer for the hover/focus swap", async () => {
		renderWithDefault(null);
		await openMenu();

		const toggle = await screen.findByRole("button", {
			name: "Set Codex as default agent",
		});

		// Visible at rest — no longer hidden until the row is hovered.
		expect(toggle.className).not.toContain("opacity-0");
		// Rest colour is the muted neutral; the swap to foreground fires only
		// when the pointer is over the pin button itself (direct hover) or the
		// button gains keyboard focus — never on row-wide hover/highlight.
		expect(toggle.className).toContain("text-muted-foreground");
		expect(toggle.className).toContain("hover:text-foreground");
		expect(toggle.className).toContain("focus-visible:text-foreground");
		expect(toggle.className).not.toContain("group-hover/item");
		expect(toggle.className).not.toContain("group-data-[highlighted]/item");
		// Icon-swap recipe: outline + filled pin stacked in a single slot.
		expect(toggle.querySelector(".default-agent-pin-swap")).toBeTruthy();
		const outline = toggle.querySelector(".default-agent-pin-outline");
		const filled = toggle.querySelector(".default-agent-pin-filled");
		expect(outline).toBeTruthy();
		expect(filled).toBeTruthy();

		// The swap triggers are icon-button-only: pointer over the pin
		// (group-hover/pin) or keyboard focus (group-focus-visible/pin). No
		// row-wide hover/highlight trigger may remain on either layer.
		for (const layer of [outline, filled] as Element[]) {
			expect(layer.className).not.toContain("group-hover/item");
			expect(layer.className).not.toContain("group-data-[highlighted]/item");
			expect(layer.className).toContain("group-hover/pin:");
			expect(layer.className).toContain("group-focus-visible/pin:");
		}

		// The pin must never blur — a 14px glyph under blur() reads as a fuzzy
		// blob. No layer may carry a blur/filter class, and the swap keeps its
		// opacity + scale (transform) motion.
		for (const layer of [outline, filled] as Element[]) {
			expect(layer.className).not.toContain("blur");
			expect(layer.className).not.toContain("filter");
			expect(layer.className).toContain("opacity");
			expect(layer.className).toContain("scale");
		}
	});

	it("renders the current default pin filled and in the foreground colour without a swap", async () => {
		renderWithDefault("codex");
		await openMenu();

		const toggle = await screen.findByRole("button", {
			name: "Unset Codex as default agent",
		});

		expect(toggle.className).toContain("text-foreground");
		expect(toggle.querySelector(".default-agent-pin-filled")).toBeTruthy();
		expect(toggle.querySelector(".default-agent-pin-swap")).toBeNull();
	});
});
