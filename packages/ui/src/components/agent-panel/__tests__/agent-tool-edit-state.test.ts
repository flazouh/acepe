import { describe, expect, it } from "bun:test";

import {
  getEditDiffKey,
  isEditInProgress,
  resolveEditHeaderState,
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
    expect(resolveEditHeaderState("done", true, false)).toBe("edited");
    expect(resolveEditHeaderState("done", false, true)).toBe(
      "awaitingApproval",
    );
    expect(resolveEditHeaderState("done", false, false)).toBe("interrupted");
    expect(resolveEditHeaderState("error", false, false)).toBe("failed");
  });

  it("shows diff pill for applied, in-progress, or awaiting approval edits", () => {
    expect(shouldShowEditDiffPill("done", true, false)).toBe(true);
    expect(shouldShowEditDiffPill("pending", false, false)).toBe(true);
    expect(shouldShowEditDiffPill("running", false, false)).toBe(true);
    expect(shouldShowEditDiffPill("done", false, true)).toBe(true);
    expect(shouldShowEditDiffPill("done", false, false)).toBe(false);
    expect(shouldShowEditDiffPill("error", false, false)).toBe(false);
  });

  it("builds unique edit keys when multiple diffs target the same file path", () => {
    expect(getEditDiffKey("src/session-list-ui.svelte", 0)).toBe(
      "src/session-list-ui.svelte:0",
    );
    expect(getEditDiffKey("src/session-list-ui.svelte", 1)).toBe(
      "src/session-list-ui.svelte:1",
    );
    expect(getEditDiffKey(undefined, 2)).toBe("edit:2");
  });
});
