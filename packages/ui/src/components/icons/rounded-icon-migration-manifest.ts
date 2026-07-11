import type { ConfirmedLinearInterfaceMapping } from "./confirmed-linear-interface-mapping.js";
import type { LinearIconName } from "./linear-icon-catalog.js";
import {
  roundedIconAliasNames,
  roundedIconNames,
  type RoundedIconName,
} from "./rounded-icon-data.generated.js";
import {
  getConfirmedLinearRoundedIconEvidence,
  mapRoundedIconToLinear,
} from "./rounded-to-linear-map.js";

type ApprovedLinearDecision = {
  readonly state: "approved-linear";
  readonly linearName: LinearIconName;
  readonly evidence: ConfirmedLinearInterfaceMapping;
  readonly rationale: string;
};

type UnresolvedDecision = {
  readonly state: "unresolved";
  readonly rationale: string;
};

type NoEquivalentDecision = {
  readonly state: "no-equivalent";
  readonly renderOutcome: "retain-acepe-geometry";
  readonly rationale: string;
  readonly rejectedLinearCandidates: readonly string[];
  readonly evidenceSource: string;
};

export type RoundedIconMigrationDecision =
  | ApprovedLinearDecision
  | UnresolvedDecision
  | NoEquivalentDecision;

const reviewedCorpus =
  "Linear 1.31.1 cache corpus 515153e5d010d576789d34a88a2a6ef3d596ac537caf8de2d1e14b2d820b977c";

const noEquivalentDecisions = new Map<
  RoundedIconName,
  NoEquivalentDecision
>([
  [
    "collapse",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "Acepe collapses a panel. Linear's traced CollapseChevronIconLarge is a vertical activity chevron, not a panel-resize control.",
      rejectedLinearCandidates: ["CollapseChevronIconLarge"],
      evidenceSource: reviewedCorpus,
    },
  ],
  [
    "download",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "Acepe downloads a file or model. Linear's DownloadAppsIcon represents installing Linear applications and device targets.",
      rejectedLinearCandidates: ["DownloadAppsIcon"],
      evidenceSource: reviewedCorpus,
    },
  ],
  [
    "expand",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "Acepe expands a panel. Linear's traced ExpandChevronIconLarge is a vertical activity chevron, not a fullscreen or panel-resize control.",
      rejectedLinearCandidates: ["ExpandChevronIconLarge"],
      evidenceSource: reviewedCorpus,
    },
  ],
  [
    "eye",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "The reviewed Linear corpus contains EyeStrikethroughIcon for hidden state but no positive Eye component or same-control binding for visible state.",
      rejectedLinearCandidates: ["EyeStrikethroughIcon"],
      evidenceSource: reviewedCorpus,
    },
  ],
  [
    "worktree",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "Linear has branch actions but no product-level Git worktree concept or worktree-bound icon in the reviewed bundle.",
      rejectedLinearCandidates: ["CopyGitBranchNameIcon"],
      evidenceSource: reviewedCorpus,
    },
  ],
  [
    "x-circle",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "No XCircle, CrossCircle, or canceled-status component exists in the reviewed Linear bundle; similarly named cancel geometry has different meaning.",
      rejectedLinearCandidates: ["CancelIcon", "CloseIcon"],
      evidenceSource: reviewedCorpus,
    },
  ],
  [
    "x-circle-filled",
    {
      state: "no-equivalent",
      renderOutcome: "retain-acepe-geometry",
      rationale:
        "No filled XCircle or canceled-status component exists in the reviewed Linear bundle.",
      rejectedLinearCandidates: ["CancelIcon", "CloseIcon"],
      evidenceSource: reviewedCorpus,
    },
  ],
]);

function approvedEvidenceFor(
  name: RoundedIconName,
): ConfirmedLinearInterfaceMapping | null {
  return getConfirmedLinearRoundedIconEvidence(name);
}

function buildDecision(name: RoundedIconName): RoundedIconMigrationDecision {
  const linearName = mapRoundedIconToLinear(name);
  if (linearName) {
    const evidence = approvedEvidenceFor(name);
    if (!evidence) {
      throw new Error(`Approved Linear icon ${name} is missing evidence`);
    }
    return {
      state: "approved-linear",
      linearName,
      evidence,
      rationale: `Approved from Linear's ${evidence.controlLabel} control.`,
    };
  }

  const noEquivalent = noEquivalentDecisions.get(name);
  if (noEquivalent) {
    return noEquivalent;
  }

  return {
    state: "unresolved",
    rationale: "Exact Linear component and same-control usage are still under review.",
  };
}

function buildManifest(): ReadonlyMap<
  RoundedIconName,
  RoundedIconMigrationDecision
> {
  const manifest = new Map<RoundedIconName, RoundedIconMigrationDecision>();
  for (const name of roundedIconNames) {
    manifest.set(name, buildDecision(name));
  }
  for (const name of roundedIconAliasNames) {
    manifest.set(name, buildDecision(name));
  }
  return manifest;
}

export const roundedIconMigrationManifest = buildManifest();

export function getRoundedIconMigrationDecision(
  name: RoundedIconName,
): RoundedIconMigrationDecision {
  const decision = roundedIconMigrationManifest.get(name);
  if (!decision) {
    throw new Error(`Missing icon migration decision for ${name}`);
  }
  return decision;
}
