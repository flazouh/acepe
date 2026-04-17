import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

// Force Svelte client runtime — Vitest resolves "svelte" to the server bundle without this override
vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

import AgentErrorCard from "../agent-error-card.svelte";

describe("AgentErrorCard", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows retry, dismiss, and copy reference actions with expandable details", async () => {
		const onRetry = vi.fn();
		const onDismiss = vi.fn();
		const onCopyReferenceId = vi.fn();
		const onIssueAction = vi.fn();

		const view = render(AgentErrorCard, {
			props: {
				title: "Resume session timed out",
				summary: "Claude failed to resume the session.",
				details: "stack line 1\nstack line 2",
				referenceId: "ref-123",
				referenceSearchable: true,
				onRetry,
				onDismiss,
				onCopyReferenceId,
				onIssueAction,
			},
		});

		expect(view.getByText("Resume session timed out")).toBeTruthy();
		await fireEvent.click(view.getByText("Copy ID"));
		expect(onCopyReferenceId).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Create issue"));
		expect(onIssueAction).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Retry"));
		expect(onRetry).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Dismiss"));
		expect(onDismiss).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Details"));
		expect(view.getByText(/stack line 1/)).toBeTruthy();
		expect(view.getByText("ref-123")).toBeTruthy();
	});
});
