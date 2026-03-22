import { describe, expect, it } from "bun:test";

import { createPanelBranchLookupController } from "../panel-branch-lookup.js";

describe("createPanelBranchLookupController", () => {
	it("requests the first eligible branch lookup once", () => {
		const controller = createPanelBranchLookupController();

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "conversation",
			})
		).toEqual({
			kind: "lookup",
			path: "/Users/test/project",
		});

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "conversation",
			})
		).toEqual({ kind: "noop" });
	});

	it("does not re-request the same branch when non-project-selection view modes churn", () => {
		const controller = createPanelBranchLookupController();

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "ready",
			})
		).toEqual({
			kind: "lookup",
			path: "/Users/test/project",
		});

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "conversation",
			})
		).toEqual({ kind: "noop" });

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "error",
			})
		).toEqual({ kind: "noop" });
	});

	it("clears branch state when lookup becomes ineligible, then looks up again when eligible", () => {
		const controller = createPanelBranchLookupController();

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "conversation",
			})
		).toEqual({
			kind: "lookup",
			path: "/Users/test/project",
		});

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "project_selection",
			})
		).toEqual({ kind: "clear" });

		expect(
			controller.next({
				lookupPath: "/Users/test/project",
				viewKind: "conversation",
			})
		).toEqual({
			kind: "lookup",
			path: "/Users/test/project",
		});
	});

	it("requests a fresh branch when the project path changes", () => {
		const controller = createPanelBranchLookupController();

		expect(
			controller.next({
				lookupPath: "/Users/test/project-a",
				viewKind: "conversation",
			})
		).toEqual({
			kind: "lookup",
			path: "/Users/test/project-a",
		});

		expect(
			controller.next({
				lookupPath: "/Users/test/project-b",
				viewKind: "conversation",
			})
		).toEqual({
			kind: "lookup",
			path: "/Users/test/project-b",
		});
	});
});
