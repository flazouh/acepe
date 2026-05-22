import { describe, expect, it } from "bun:test";

import {
  getEditDisplayModel,
  getEditFileName,
  getEditHeaderLabel,
  isEditInProgress,
  resolveEditHeaderState,
  resolveEditDiffs,
  shouldShowEditDiffPill,
} from "../agent-tool-edit-state.js";

describe("agent-tool-edit-state", () => {
  it("marks pending and running as in-progress", () => {
    expect(isEditInProgress("pending")).toBe(true);
    expect(isEditInProgress("running")).toBe(true);
    expect(isEditInProgress("done")).toBe(false);
    expect(isEditInProgress("error")).toBe(false);
  });

  it("resolves header state from status + applied + approval flags", () => {
    expect(resolveEditHeaderState("pending", false, false)).toBe("editing");
    expect(resolveEditHeaderState("running", false, false)).toBe("editing");
    expect(resolveEditHeaderState("pending", false, true)).toBe(
      "awaitingApproval",
    );
    expect(resolveEditHeaderState("running", false, true)).toBe(
      "awaitingApproval",
    );
    expect(resolveEditHeaderState("done", true, false)).toBe("edited");
    expect(resolveEditHeaderState("done", false, true)).toBe(
      "awaitingApproval",
    );
    expect(resolveEditHeaderState("done", true, true)).toBe("awaitingApproval");
    expect(resolveEditHeaderState("done", false, false)).toBe("interrupted");
    expect(resolveEditHeaderState("error", false, false)).toBe("failed");
    expect(resolveEditHeaderState("blocked", false, false)).toBe("blocked");
    expect(resolveEditHeaderState("cancelled", false, false)).toBe("cancelled");
    expect(resolveEditHeaderState("degraded", false, false)).toBe("degraded");
  });

  it("shows diff pill for applied, in-progress, or awaiting approval edits", () => {
    expect(shouldShowEditDiffPill("done", true, false)).toBe(true);
    expect(shouldShowEditDiffPill("pending", false, false)).toBe(true);
    expect(shouldShowEditDiffPill("running", false, false)).toBe(true);
    expect(shouldShowEditDiffPill("done", false, true)).toBe(true);
    expect(shouldShowEditDiffPill("done", false, false)).toBe(false);
    expect(shouldShowEditDiffPill("error", false, false)).toBe(false);
  });

  it("derives file names from paths", () => {
    expect(getEditFileName("/repo/src/app.ts")).toBe("app.ts");
    expect(getEditFileName("README.md")).toBe("README.md");
    expect(getEditFileName(null)).toBeNull();
  });

  it("resolves explicit diffs with new content only", () => {
    expect(
      resolveEditDiffs({
        diffs: [
          { filePath: "/repo/a.ts", newString: "new" },
          { filePath: "/repo/b.ts", newString: null },
        ],
        additions: 0,
        deletions: 0,
      }),
    ).toEqual([{ filePath: "/repo/a.ts", newString: "new" }]);
  });

  it("builds a single fallback diff from legacy props", () => {
    expect(
      resolveEditDiffs({
        diffs: [],
        filePath: "/repo/src/app.ts",
        additions: 2,
        deletions: 1,
        oldString: "old",
        newString: "new",
      }),
    ).toEqual([
      {
        filePath: "/repo/src/app.ts",
        fileName: "app.ts",
        additions: 2,
        deletions: 1,
        oldString: "old",
        newString: "new",
      },
    ]);
    expect(
      resolveEditDiffs({
        diffs: [],
        additions: 0,
        deletions: 0,
        newString: null,
      }),
    ).toEqual([]);
  });

  it("builds display model for single and multiple diffs", () => {
    const single = getEditDisplayModel({
      resolvedDiffs: [{ filePath: "/repo/src/app.ts", newString: "new" }],
      filePath: null,
      fileName: null,
      showDiffPill: true,
      additions: 3,
      deletions: 2,
    });

    expect(single.hasMultipleDiffs).toBe(false);
    expect(single.hasContent).toBe(true);
    expect(single.derivedFileName).toBe("app.ts");
    expect(single.displayedFilePath).toBe("/repo/src/app.ts");
    expect(single.displayedFileCountLabel).toBeNull();
    expect(single.displayedAdditions).toBe(3);
    expect(single.displayedDeletions).toBe(2);

    const multiple = getEditDisplayModel({
      resolvedDiffs: [
        { filePath: "/repo/a.ts", newString: "a" },
        { filePath: "/repo/b.ts", newString: "b" },
      ],
      showDiffPill: false,
      additions: 3,
      deletions: 2,
    });

    expect(multiple.hasMultipleDiffs).toBe(true);
    expect(multiple.displayedFileCountLabel).toBe("2 files");
    expect(multiple.displayedAdditions).toBe(0);
    expect(multiple.displayedDeletions).toBe(0);
  });

  it("maps header state to labels", () => {
    const labels = {
      editingLabel: "Editing",
      editedLabel: "Edited",
      awaitingApprovalLabel: "Awaiting",
      interruptedLabel: "Interrupted",
      failedLabel: "Failed",
      blockedLabel: "Blocked",
      cancelledLabel: "Cancelled",
      degradedLabel: "Degraded",
      pendingLabel: "Pending",
    };

    expect(getEditHeaderLabel("editing", labels)).toBe("Editing");
    expect(getEditHeaderLabel("edited", labels)).toBe("Edited");
    expect(getEditHeaderLabel("awaitingApproval", labels)).toBe("Awaiting");
    expect(getEditHeaderLabel("interrupted", labels)).toBe("Interrupted");
    expect(getEditHeaderLabel("failed", labels)).toBe("Failed");
    expect(getEditHeaderLabel("blocked", labels)).toBe("Blocked");
    expect(getEditHeaderLabel("cancelled", labels)).toBe("Cancelled");
    expect(getEditHeaderLabel("degraded", labels)).toBe("Degraded");
  });
});
