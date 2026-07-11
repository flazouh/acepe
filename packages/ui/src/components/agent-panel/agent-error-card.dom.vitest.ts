import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentErrorCard from "./agent-error-card.svelte";

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

describe("AgentErrorCard", () => {
	it("puts the provider failure first and keeps technical details collapsed", async () => {
		const view = render(AgentErrorCard, {
			props: {
				title: "Request error",
				summary: "UnknownError",
				details: 'Code: UnknownError\n\nSource: unknown\n\n{"name":"UnknownError"}',
			},
		});

		const alert = view.getByRole("alert");
		const primary = view.getByText("UnknownError");
		const classification = view.getByText("Request error");
		const disclosure = view.getByText("Technical details").closest("details");

		expect(alert.dataset.qa).toBe("agent-error-card");
		expect(primary.dataset.qa).toBe("agent-error-primary-message");
		expect(
			primary.compareDocumentPosition(classification) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(disclosure?.dataset.qa).toBe("agent-error-technical-details");
		expect(disclosure?.hasAttribute("open")).toBe(false);

		await fireEvent.click(view.getByText("Technical details"));
		expect(disclosure?.hasAttribute("open")).toBe(true);
		expect(view.getByText(/Source: unknown/)).toBeTruthy();
	});

	it("keeps actions after the primary message", () => {
		const onRetry = vi.fn();
		const view = render(AgentErrorCard, {
			props: {
				title: "Request error",
				summary: "Model unavailable",
				details: "Code: MODEL_NOT_FOUND",
				onRetry,
			},
		});

		const primary = view.getByText("Model unavailable");
		const actions = view.container.querySelector('[data-qa="agent-error-actions"]');
		expect(actions).toBeTruthy();
		expect(primary.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("renders provider diagnostics as inert text", () => {
		const diagnostic = '<script>alert("secret")</script>';
		const view = render(AgentErrorCard, {
			props: {
				title: "Request error",
				summary: "Provider rejected the request",
				details: diagnostic,
			},
		});

		expect(view.getByText(diagnostic)).toBeTruthy();
		expect(view.container.querySelector("script")).toBeNull();
	});
});
