import { cleanup, fireEvent, render } from "@testing-library/svelte";
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

import LibrarySidebar from "./library-sidebar.svelte";
import type { LibrarySidebarViewModel } from "./library-sidebar-state.js";

afterEach(() => {
	cleanup();
});

const model: LibrarySidebarViewModel = {
	projectsHeading: "Projects",
	sessionsHeading: "Sessions",
	emptyProjectsLabel: "No projects",
	emptySessionsLabel: "Select a project",
	selectedProjectId: "project-1",
	selectedSessionId: null,
	projects: [
		{
			id: "project-1",
			title: "Acepe",
			deleted: false,
			deletedLabel: null,
		},
	],
	sessions: [
		{
			id: "session-active",
			title: "Fix the auth bug",
			lifecycle: "active",
			lifecycleLabel: null,
		},
		{
			id: "session-archived",
			title: "Archived thread",
			lifecycle: "archived",
			lifecycleLabel: "Archived",
		},
		{
			id: "session-deleted",
			title: "Deleted thread",
			lifecycle: "deleted",
			lifecycleLabel: "Deleted",
		},
	],
};

describe("LibrarySidebar", () => {
	it("renders projection titles and archived and deleted session states", () => {
		const onSelectProject = vi.fn();
		const view = render(LibrarySidebar, {
			props: {
				model,
				onSelectProject,
			},
		});

		expect(view.getByTestId("library-sidebar")).toBeTruthy();
		expect(
			view.getByTestId("library-project").getAttribute("data-project-state"),
		).toBe("active");
		expect(view.getByText("Fix the auth bug")).toBeTruthy();
		expect(view.getByText("Archived thread")).toBeTruthy();
		expect(view.getByText("Deleted thread")).toBeTruthy();
		expect(
			view
				.getByText("Archived thread")
				.closest("[data-session-state]")
				?.getAttribute("data-session-state"),
		).toBe("archived");
		expect(
			view
				.getByText("Deleted thread")
				.closest("[data-session-state]")
				?.getAttribute("data-session-state"),
		).toBe("deleted");
	});

	it("calls onSelectProject with the project id", async () => {
		const onSelectProject = vi.fn();
		const view = render(LibrarySidebar, {
			props: {
				model,
				onSelectProject,
			},
		});
		await fireEvent.click(view.getByTestId("library-project"));
		expect(onSelectProject).toHaveBeenCalledWith("project-1");
	});

	it("calls onOpenReview from the review button when a project is selected", async () => {
		const onSelectProject = vi.fn();
		const onOpenReview = vi.fn();
		const view = render(LibrarySidebar, {
			props: {
				model,
				onSelectProject,
				onOpenReview,
				reviewButtonLabel: "Review changes",
			},
		});
		expect(view.getByTestId("git-review-open").textContent).toBe(
			"Review changes",
		);
		await fireEvent.click(view.getByTestId("git-review-open"));
		expect(onOpenReview).toHaveBeenCalledTimes(1);
	});

	it("hides the review button when onOpenReview is omitted", () => {
		const view = render(LibrarySidebar, {
			props: {
				model,
				onSelectProject: vi.fn(),
			},
		});
		expect(view.queryByTestId("git-review-open")).toBeNull();
	});

	it("calls onSelectSession with the session id", async () => {
		const onSelectProject = vi.fn();
		const onSelectSession = vi.fn();
		const view = render(LibrarySidebar, {
			props: {
				model: {
					projectsHeading: model.projectsHeading,
					sessionsHeading: model.sessionsHeading,
					emptyProjectsLabel: model.emptyProjectsLabel,
					emptySessionsLabel: model.emptySessionsLabel,
					selectedProjectId: model.selectedProjectId,
					selectedSessionId: "session-active",
					projects: model.projects,
					sessions: model.sessions,
				},
				onSelectProject,
				onSelectSession,
			},
		});
		const sessions = view.getAllByTestId("library-session");
		const first = sessions[0];
		expect(first).toBeTruthy();
		if (first === undefined) {
			return;
		}
		expect(first.tagName).toBe("BUTTON");
		await fireEvent.click(first);
		expect(onSelectSession).toHaveBeenCalledWith("session-active");
	});
});
