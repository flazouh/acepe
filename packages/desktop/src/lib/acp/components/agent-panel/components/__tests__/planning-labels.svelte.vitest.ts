import { AgentPanelConversationEntry, AgentPanelLayout, AgentPanelSceneEntry } from "@acepe/ui";
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

afterEach(() => {
	cleanup();
});

describe("planning placeholder labels", () => {
	it("keeps the shared conversation entry label static even when duration is present", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "thinking-entry",
				type: "thinking",
				durationMs: 4_000,
			},
		});

		expect(view.getByText("Planning next moves")).toBeTruthy();
		expect(view.queryByRole("status", { name: "Loading" })).toBeNull();
		expect(view.queryByText("Planning next moves for 4s")).toBeNull();
		expect(view.queryByText("Planning next moves…")).toBeNull();
	});

	it("shows a for-duration chip beside the thinking planning placeholder", () => {
		const startedAtMs = Date.now() - 4_000;
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "thinking-entry",
				type: "thinking",
				durationMs: null,
				startedAtMs,
			},
		});

		expect(view.getByText(/Planning next moves for/)).toBeTruthy();
		expect(view.getByTestId("agent-tool-duration-label")).toBeTruthy();
	});

	it("keeps the scene entry label static even when duration is present", () => {
		const view = render(AgentPanelSceneEntry, {
			entry: {
				id: "thinking-entry",
				type: "thinking",
				durationMs: 4_000,
			},
		});

		expect(view.getByText("Planning next moves")).toBeTruthy();
		expect(view.queryByRole("status", { name: "Loading" })).toBeNull();
		expect(view.queryByText("Planning next moves for 4s")).toBeNull();
		expect(view.queryByText("Planning next moves…")).toBeNull();
	});
});

describe("shared conversation row coverage", () => {
	it("renders a user entry through the shared conversation dispatcher", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "user-entry",
				type: "user",
				text: "Please inspect src/app.ts",
			},
		});

		expect(view.getByText("Please inspect src/app.ts")).toBeTruthy();
	});

	it("renders an assistant entry through the shared conversation dispatcher", async () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "assistant-entry",
				type: "assistant",
				markdown: "Done with the review.",
				isStreaming: false,
			},
		});

		expect(await view.findByText("Done with the review.")).toBeTruthy();
	});

	it("accepts a streaming assistant entry in the shared conversation dispatcher", async () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "assistant-entry",
				type: "assistant",
				markdown: "Streaming response",
				isStreaming: true,
			},
		});

		expect(await view.findByText("Streaming response")).toBeTruthy();
	});

	it("renders a degraded missing row through the shared conversation dispatcher", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "missing-entry",
				type: "missing",
				diagnosticLabel: "scene:assistant-404",
			},
		});

		expect(view.getByRole("status", { name: "Message unavailable" })).toBeTruthy();
		expect(view.getByText("This message could not be loaded.")).toBeTruthy();
		expect(view.getByText("scene:assistant-404")).toBeTruthy();
	});

	it("renders a representative tool row through the shared conversation dispatcher", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "tool-entry",
				type: "tool_call",
				kind: "other",
				title: "Tool unavailable",
				status: "degraded",
				detailsText: "Missing canonical operation",
			},
		});

		expect(view.getByText("Tool unavailable")).toBeTruthy();
	});

	it("disables plan approval actions when the backing approval is unavailable", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "plan-entry",
				type: "tool_call",
				kind: "exit_plan_mode",
				title: "Plan ready",
				status: "pending",
				toolCallId: "tool-plan-1",
				planTitle: "Plan ready",
				planContent: "# Plan ready\n\nDo the work.",
				planStatus: "interactive",
			},
			onPlanBuild: vi.fn(),
			onPlanCancel: vi.fn(),
			onPlanViewFull: vi.fn(),
			isPlanActionAvailable: () => false,
		});

		const build = view.getByRole("button", { name: "Build" }) as HTMLButtonElement;
		const cancel = view.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
		const open = view.getByRole("button", { name: "Open full plan" }) as HTMLButtonElement;

		expect(build.disabled).toBe(true);
		expect(cancel.disabled).toBe(true);
		expect(open.disabled).toBe(false);
	});
});

describe("skill tool rendering", () => {
	it("renders skill names in the shared conversation fallback renderer", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "skill-entry",
				type: "tool_call",
				kind: "skill",
				title: "Skill",
				status: "done",
				skillName: "frontend-design",
				skillArgs: null,
				skillDescription: null,
			},
		});

		expect(view.getByText("/frontend-design")).toBeTruthy();
		expect(view.queryByText("Skill")).toBeNull();
	});

	it("renders skill names in the scene renderer", () => {
		const view = render(AgentPanelSceneEntry, {
			entry: {
				id: "skill-entry",
				type: "tool_call",
				kind: "skill",
				title: "Skill",
				status: "done",
				skillName: "agent-browser",
				skillArgs: null,
				skillDescription: null,
			},
		});

		expect(view.getByText("/agent-browser")).toBeTruthy();
		expect(view.queryByText("Skill")).toBeNull();
	});

	it("renders skill names in the legacy panel layout renderer", () => {
		const view = render(AgentPanelLayout, {
			entries: [
				{
					id: "skill-entry",
					type: "tool_call",
					kind: "skill",
					title: "Skill",
					status: "done",
					skillName: "frontend-design",
					skillArgs: null,
					skillDescription: null,
				},
			],
		});

		expect(view.getByText("/frontend-design")).toBeTruthy();
		expect(view.queryByText("Skill")).toBeNull();
	});
});
