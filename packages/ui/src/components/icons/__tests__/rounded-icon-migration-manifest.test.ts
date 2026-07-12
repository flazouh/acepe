import { describe, expect, it } from "vitest";

import {
  resolveRoundedIconName,
  roundedIconAliasNames,
  roundedIconData,
  roundedIconNames,
} from "../rounded-icon-data.generated.js";
import {
  getRoundedIconMigrationDecision,
  roundedIconMigrationManifest,
} from "../rounded-icon-migration-manifest.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";

describe("rounded icon migration manifest", () => {
  it("contains one decision for every runtime icon name and alias", () => {
    const allNames = new Set([...roundedIconNames, ...roundedIconAliasNames]);

    expect(roundedIconMigrationManifest.size).toBe(allNames.size);
    for (const name of allNames) {
      expect(roundedIconMigrationManifest.has(name)).toBe(true);
    }
  });

  it("keeps approved decisions aligned with the runtime resolver", () => {
    for (const [name, decision] of roundedIconMigrationManifest) {
      if (decision.state === "approved-linear") {
        expect(mapRoundedIconToLinear(name)).toBe(decision.linearName);
      }
    }
  });

  it("records rejected lookalikes as renderable no-equivalent decisions", () => {
    for (const name of [
      "collapse",
      "download",
      "expand",
      "eye",
      "worktree",
      "x-circle",
      "x-circle-filled",
    ] as const) {
      expect(getRoundedIconMigrationDecision(name)).toMatchObject({
        state: "no-equivalent",
        renderOutcome: "retain-acepe-geometry",
      });
    }
  });

  it("documents the rejected Linear candidates for confusing high-risk names", () => {
    expect(getRoundedIconMigrationDecision("archive")).toMatchObject({
      state: "no-equivalent",
      rejectedLinearCandidates: [
        "ArchiveIcon",
        "OpenArchiveIcon",
        "UnarchiveIcon",
        "RetireIcon",
      ],
    });
    expect(getRoundedIconMigrationDecision("sidebar")).toMatchObject({
      state: "no-equivalent",
      rejectedLinearCandidates: ["CustomizeSidebarIcon", "SidebarPanelIcon"],
    });
    expect(getRoundedIconMigrationDecision("folder")).toMatchObject({
      state: "no-equivalent",
      rejectedLinearCandidates: ["Folder", "NewFolderIcon"],
    });
    expect(getRoundedIconMigrationDecision("copy")).toMatchObject({
      state: "no-equivalent",
      rejectedLinearCandidates: [
        "CopyIcon",
        "CopyIdIcon",
        "CopyGitBranchNameIcon",
      ],
    });
    expect(getRoundedIconMigrationDecision("settings")).toMatchObject({
      state: "no-equivalent",
      rejectedLinearCandidates: [
        "UserSettingsIcon",
        "RecurringIssueSettingsIcon",
      ],
    });
  });

  it("leaves no runtime icon in an unresolved migration state", () => {
    const unresolvedNames: string[] = [];
    for (const [name, decision] of roundedIconMigrationManifest) {
      if (decision.state === "unresolved") {
        unresolvedNames.push(name);
      }
    }

    expect(unresolvedNames).toEqual([]);
  });

  it("bundles legacy geometry only for structured no-equivalent outcomes", () => {
    const expectedFallbackSources = new Set<string>();
    for (const [name, decision] of roundedIconMigrationManifest) {
      if (decision.state === "no-equivalent") {
        expectedFallbackSources.add(resolveRoundedIconName(name));
      }
    }

    expect(Object.keys(roundedIconData).sort()).toEqual(
      Array.from(expectedFallbackSources).sort(),
    );
  });

  it("retains Acepe geometry for every runtime decision while Linear evidence is retraced", () => {
    for (const [, decision] of roundedIconMigrationManifest) {
      expect(decision).toMatchObject({
        state: "no-equivalent",
        renderOutcome: "retain-acepe-geometry",
      });
    }
  });
});
