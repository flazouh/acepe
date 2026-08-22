import { describe, expect, it } from "bun:test"

import { isSelectedProject } from "./index.js"

describe("library-sidebar exports", () => {
	it("exports the selected-project helper", () => {
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: "project-1",
			}),
		).toBe(true)
	})
})
