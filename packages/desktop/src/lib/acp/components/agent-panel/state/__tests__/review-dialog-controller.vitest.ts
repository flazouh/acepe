import { describe, expect, it } from "vitest";
import type { ModifiedFilesState } from "../../../../types/modified-files-state.js";
import { ReviewDialogController } from "../review-dialog-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("ReviewDialogController", () => {
	const filesState = (
		files: { totalAdded: number; totalRemoved: number }[]
	): ModifiedFilesState =>
		({ fileCount: files.length, files }) as unknown as ModifiedFilesState;

	it("starts closed with empty state", () => {
		const c = new ReviewDialogController();
		expect(c.isOpen).toBe(false);
		expect(c.filesState).toBeNull();
		expect(c.controls).toBeNull();
		expect(c.clampedFileIndex).toBe(0);
		expect(c.diffStats).toEqual({ insertions: 0, deletions: 0 });
	});

	it("open() sets files + index and opens", () => {
		const c = new ReviewDialogController();
		const fs = filesState([{ totalAdded: 1, totalRemoved: 0 }]);
		c.open(fs, 0);
		expect(c.isOpen).toBe(true);
		expect(c.filesState).toEqual(fs);
	});

	it("clamps the file index into the file-count range", () => {
		const c = new ReviewDialogController();
		c.open(filesState([{ totalAdded: 0, totalRemoved: 0 }, { totalAdded: 0, totalRemoved: 0 }]), 0);
		c.setFileIndex(99);
		expect(c.clampedFileIndex).toBe(1); // fileCount 2 -> max index 1
		c.setFileIndex(-5);
		expect(c.clampedFileIndex).toBe(0);
	});

	it("aggregates diff stats across files", () => {
		const c = new ReviewDialogController();
		c.open(
			filesState([
				{ totalAdded: 3, totalRemoved: 1 },
				{ totalAdded: 4, totalRemoved: 2 },
			]),
			0
		);
		expect(c.diffStats).toEqual({ insertions: 7, deletions: 3 });
	});

	it("setControls stores the latest snapshot", () => {
		const c = new ReviewDialogController();
		const snapshot = { foo: "bar" } as never;
		c.setControls(snapshot);
		expect(c.controls).toEqual(snapshot);
	});

	it("setOpen(false) resets the files snapshot and index; setOpen(true) does not", () => {
		const c = new ReviewDialogController();
		c.open(filesState([{ totalAdded: 1, totalRemoved: 1 }]), 0);
		c.setFileIndex(0);
		c.setOpen(false);
		expect(c.isOpen).toBe(false);
		expect(c.filesState).toBeNull();
		expect(c.clampedFileIndex).toBe(0);

		const fs = filesState([{ totalAdded: 2, totalRemoved: 0 }]);
		c.open(fs, 0);
		c.setOpen(true);
		expect(c.isOpen).toBe(true);
		expect(c.filesState).toEqual(fs);
	});
});
