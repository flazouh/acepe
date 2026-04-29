import { describe, expect, it } from "bun:test";

import {
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
});
