import { describe, expect, it } from "vitest";

import {
  roundedIconAliasNames,
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
});
