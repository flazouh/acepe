import { describe, expect, it } from "bun:test"

import { isSelectedProject } from "./library-sidebar-state.js"

describe("isSelectedProject", () => {
	it("is true only for the selected project id", () => {
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: "project-1",
			}),
		).toBe(true)
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: "project-2",
			}),
		).toBe(false)
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: null,
			}),
		).toBe(false)
	})
})
