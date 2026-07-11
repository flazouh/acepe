import { describe, expect, it } from "vitest";

import { linearIconNames } from "../linear-icon-catalog.js";
import {
  roundedIconAliasNames,
  roundedIconNames,
  type RoundedIconName,
} from "../rounded-icon-data.generated.js";
import {
  confirmedLinearInterfaceMappings,
  mapRoundedIconToLinear,
} from "../rounded-to-linear-map.js";

const linearIconNameSet = new Set<string>(linearIconNames);

describe("rounded-to-linear-map", () => {
  it("returns either a confirmed Linear mapping or an explicit fallback", () => {
    const allNames: RoundedIconName[] = [];
    for (const name of roundedIconNames) {
      allNames.push(name);
    }
    for (const name of roundedIconAliasNames) {
      allNames.push(name);
    }

    for (const name of allNames) {
      const linearName = mapRoundedIconToLinear(name);
      expect(linearName === null || linearIconNameSet.has(linearName)).toBe(
        true,
      );
    }
  });

  it("rejects unobserved decorative-only substitutions", () => {
    expect(mapRoundedIconToLinear("info")).toBeNull();
    expect(mapRoundedIconToLinear("download")).toBeNull();
  });

  it("maps settings to the gear observed in Linear General settings", () => {
    expect(mapRoundedIconToLinear("settings")).toBe("feature-svg6bdd3b6f165e");
  });

  it("maps the settings icons proven by Linear's page configuration", () => {
    expect(mapRoundedIconToLinear("lock")).toBe("small-lock");
    expect(mapRoundedIconToLinear("members")).toBe("members");
  });

  it("maps exact Linear semantic exports used by Acepe controls", () => {
    expect(mapRoundedIconToLinear("archive")).toBe("archive");
    expect(mapRoundedIconToLinear("chevron-down")).toBe("chevron-down");
    expect(mapRoundedIconToLinear("chevron-left")).toBe("chevron-left");
    expect(mapRoundedIconToLinear("chevron-right")).toBe("chevron-right");
    expect(mapRoundedIconToLinear("chevron-up")).toBe("chevron-up");
    expect(mapRoundedIconToLinear("folder")).toBe("folder");
    expect(mapRoundedIconToLinear("refresh")).toBe("refresh");
    expect(mapRoundedIconToLinear("send")).toBe("send");
    expect(mapRoundedIconToLinear("comment")).toBe("comment");
    expect(mapRoundedIconToLinear("cursor")).toBe("cursor");
    expect(mapRoundedIconToLinear("team")).toBe("team");
    expect(mapRoundedIconToLinear("more")).toBe("horizontal-ellipsis");
    expect(mapRoundedIconToLinear("play")).toBe("play");
    expect(mapRoundedIconToLinear("sidebar")).toBe("sidebar-panel");
    expect(mapRoundedIconToLinear("eye-off")).toBe("eye-strikethrough");
    expect(mapRoundedIconToLinear("folders")).toBe("folder");
    expect(mapRoundedIconToLinear("github")).toBe("git-hub");
    expect(mapRoundedIconToLinear("check")).toBe("check");
  });

  it("maps decorative sprites only after tracing Linear control bindings", () => {
    expect(mapRoundedIconToLinear("alert")).toBe("alert");
    expect(mapRoundedIconToLinear("brain")).toBe("brain");
    expect(mapRoundedIconToLinear("bug")).toBe("bug");
    expect(mapRoundedIconToLinear("chat")).toBe("chat");
    expect(mapRoundedIconToLinear("image")).toBe("image");
    expect(mapRoundedIconToLinear("terminal")).toBe("terminal");
    expect(mapRoundedIconToLinear("trash")).toBe("trash");
    expect(mapRoundedIconToLinear("warning")).toBe("alert");
    expect(mapRoundedIconToLinear("question-circle")).toBe("question-mark");
    expect(mapRoundedIconToLinear("question")).toBe("question-mark");
    expect(mapRoundedIconToLinear("globe")).toBe("world");
    expect(mapRoundedIconToLinear("browser")).toBe("world");
    expect(mapRoundedIconToLinear("gpu")).toBe("moon");
    expect(mapRoundedIconToLinear("moon")).toBe("moon");
    expect(mapRoundedIconToLinear("clock")).toBe("clock--outline");
    expect(mapRoundedIconToLinear("star")).toBe("starred");
    expect(mapRoundedIconToLinear("lightning")).toBe("bolt");
  });

  it("maps Acepe state indicators to named Linear issue states", () => {
    expect(mapRoundedIconToLinear("check-circle")).toBe("issue-status-done");
    expect(mapRoundedIconToLinear("check-circle-filled")).toBe(
      "issue-status-done",
    );
    expect(mapRoundedIconToLinear("circle-dashed")).toBe(
      "issue-status-backlog",
    );
  });

  it("maps permission states to Linear security and warning controls", () => {
    expect(mapRoundedIconToLinear("shield-check")).toBe("shield");
    expect(mapRoundedIconToLinear("shield-code")).toBe("shield");
    expect(mapRoundedIconToLinear("permissions")).toBe("shield");
    expect(mapRoundedIconToLinear("shield-warning")).toBe("alert");
  });

  it("maps Acepe code controls to Linear's base CodeBlock export", () => {
    expect(mapRoundedIconToLinear("code")).toBe("code-block");
  });

  it("maps task and plan surfaces to Linear's base Checklist export", () => {
    expect(mapRoundedIconToLinear("plan")).toBe("checklist");
    expect(mapRoundedIconToLinear("tasks")).toBe("checklist");
  });

  it("maps document surfaces to Linear's traced Documents symbol", () => {
    expect(mapRoundedIconToLinear("document")).toBe("page");
    expect(mapRoundedIconToLinear("file-text")).toBe("page");
  });

  it("reuses approved Linear action exports for equivalent Acepe controls", () => {
    expect(mapRoundedIconToLinear("arrow-right")).toBe("chevron-right");
    expect(mapRoundedIconToLinear("arrow-up")).toBe("send");
    expect(mapRoundedIconToLinear("branch")).toBe("copy-git-branch-name");
    expect(mapRoundedIconToLinear("external-link")).toBe("open-in-new-window");
    expect(mapRoundedIconToLinear("stop")).toBe("send-stop-request");
    expect(mapRoundedIconToLinear("play-outline")).toBe("play");
    expect(mapRoundedIconToLinear("paper-plane")).toBe("send");
    expect(mapRoundedIconToLinear("regenerate")).toBe("refresh");
    expect(mapRoundedIconToLinear("undo")).toBe("document-history");
    expect(mapRoundedIconToLinear("new-chat")).toBe("plus");
  });

  it("maps Agent Skills to Linear's traced settings component", () => {
    expect(mapRoundedIconToLinear("skills")).toBe("skills");
  });

  it("maps MCP integrations to Linear's traced MCP Server symbol", () => {
    expect(mapRoundedIconToLinear("mcp")).toBe("server");
  });

  it("maps view controls to Linear's traced Display options component", () => {
    expect(mapRoundedIconToLinear("sliders")).toBe("display-options");
  });

  it("maps indeterminate controls to Linear's SimpleActionMenu bar", () => {
    expect(mapRoundedIconToLinear("minus")).toBe("feature-svg3e5519fc6635");
  });

  it("binds every confirmed mapping to approved geometry evidence", () => {
    for (const [name, evidence] of Object.entries(
      confirmedLinearInterfaceMappings,
    )) {
      expect(evidence.evidenceState).toBe("approved");
      expect(evidence.geometryHash).toHaveLength(64);
      expect(mapRoundedIconToLinear(name as RoundedIconName)).toBe(
        evidence.linearName,
      );
    }
  });

  it("keeps aliases on fallback when their candidates are decorative", () => {
    expect(mapRoundedIconToLinear("bell")).toBeNull();
    expect(mapRoundedIconToLinear("automations")).toBeNull();
  });

  it("maps aliases whose source icon already has approved evidence", () => {
    expect(mapRoundedIconToLinear("files")).toBe("folder");
    expect(mapRoundedIconToLinear("three")).toBe("horizontal-ellipsis");
    expect(mapRoundedIconToLinear("sidebar-closed")).toBe("sidebar-panel");
    expect(mapRoundedIconToLinear("settings-cog")).toBe(
      "feature-svg6bdd3b6f165e",
    );
  });
});
