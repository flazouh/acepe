import { cleanup, fireEvent, render } from "@testing-library/svelte"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module")
	const { dirname, join } = await import("node:path")
	const require = createRequire(import.meta.url)
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	)

	return import(/* @vite-ignore */ svelteClientPath)
})

import LibrarySidebar from "./library-sidebar.svelte"
import type { LibrarySidebarViewModel } from "./library-sidebar-state.js"

afterEach(() => {
	cleanup()
})

const model: LibrarySidebarViewModel = {
	projectsHeading: "Projects",
	sessionsHeading: "Sessions",
	emptyProjectsLabel: "No projects",
	emptySessionsLabel: "Select a project",
	selectedProjectId: "project-1",
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
}

describe("LibrarySidebar", () => {
	it("renders projection titles and archived and deleted session states", () => {
		const onSelectProject = vi.fn()
		const view = render(LibrarySidebar, {
			props: {
				model,
				onSelectProject,
			},
		})

		expect(view.getByTestId("library-sidebar")).toBeTruthy()
		expect(view.getByTestId("library-project").getAttribute("data-project-state")).toBe("active")
		expect(view.getByText("Fix the auth bug")).toBeTruthy()
		expect(view.getByText("Archived thread")).toBeTruthy()
		expect(view.getByText("Deleted thread")).toBeTruthy()
		expect(
			view.getByText("Archived thread").closest("[data-session-state]")?.getAttribute(
				"data-session-state",
			),
		).toBe("archived")
		expect(
			view.getByText("Deleted thread").closest("[data-session-state]")?.getAttribute(
				"data-session-state",
			),
		).toBe("deleted")
	})

	it("calls onSelectProject with the project id", async () => {
		const onSelectProject = vi.fn()
		const view = render(LibrarySidebar, {
			props: {
				model,
				onSelectProject,
			},
		})
		await fireEvent.click(view.getByTestId("library-project"))
		expect(onSelectProject).toHaveBeenCalledWith("project-1")
	})
})
