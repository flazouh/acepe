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
const invalidatedRuntimeMappingReview =
  "Runtime Linear mappings invalidated after full visual audit found wrong geometry and non-reproducible evidence";

function retainAcepeGeometry(
  rationale: string,
  rejectedLinearCandidates: readonly string[],
): NoEquivalentDecision {
  return {
    state: "no-equivalent",
    renderOutcome: "retain-acepe-geometry",
    rationale,
    rejectedLinearCandidates,
    evidenceSource: reviewedCorpus,
  };
}

const noEquivalentDecisions = new Map<
  RoundedIconName,
  NoEquivalentDecision
>([
  [
    "archive",
    retainAcepeGeometry(
      "Linear exposes several archive-like glyphs, but they are bound to different controls and share geometry with Group, Retire, OpenArchive, and Unarchive. Acepe's archive action must be retraced at its exact runtime control before migration.",
      ["ArchiveIcon", "OpenArchiveIcon", "UnarchiveIcon", "RetireIcon"],
    ),
  ],
  [
    "animated",
    retainAcepeGeometry(
      "Acepe uses a generic animated activity glyph. Linear's extracted animated arrows express vertical movement, not generic activity.",
      ["AnimatedArrowUpDownIcon"],
    ),
  ],
  [
    "apps",
    retainAcepeGeometry(
      "No Linear control binds an extracted glyph to a generic applications grid; Spaces and AiApp are different product concepts.",
      ["Spaces", "AiApp"],
    ),
  ],
  [
    "appshot",
    retainAcepeGeometry(
      "The reviewed Linear corpus has no same-control application screenshot glyph.",
      ["ViewFinder"],
    ),
  ],
  [
    "arrow-top-right",
    retainAcepeGeometry(
      "Linear's Direction sprite has no traced binding to Acepe's diagonal navigation action.",
      ["Direction"],
    ),
  ],
  [
    "arrow-up-right",
    retainAcepeGeometry(
      "Linear's Direction sprite has no traced binding to Acepe's diagonal navigation action.",
      ["Direction"],
    ),
  ],
  [
    "bell",
    retainAcepeGeometry(
      "Bell shares legacy geometry storage with Automations but has notification meaning and must not inherit the Automation mapping.",
      ["Automation", "Alarm"],
    ),
  ],
  [
    "building",
    retainAcepeGeometry(
      "Linear's Factory sprite is not bound to the organization/building control represented by Acepe.",
      ["Factory"],
    ),
  ],
  [
    "chart-line",
    retainAcepeGeometry(
      "Linear's generic Chart sprite has no traced same-control binding for Acepe's line-chart state.",
      ["Chart"],
    ),
  ],
  [
    "chats",
    retainAcepeGeometry(
      "Linear's Conversation decorative sprite has no traced binding to Acepe's multi-chat control.",
      ["Conversation"],
    ),
  ],
  [
    "chrome",
    retainAcepeGeometry(
      "The Chrome sprite exists only in Linear's decorative set; no Chrome control binding was found in the reviewed corpus.",
      ["Chrome"],
    ),
  ],
  [
    "cloud",
    retainAcepeGeometry(
      "The Cloud sprite exists only in Linear's decorative set with no same-control binding.",
      ["Cloud"],
    ),
  ],
  [
    "copy",
    retainAcepeGeometry(
      "Linear has multiple incompatible copy glyphs, including generic Copy, Copy ID, and Copy Git Branch Name controls. Acepe's generic copy icon must not inherit the Copy ID geometry.",
      ["CopyIcon", "CopyIdIcon", "CopyGitBranchNameIcon"],
    ),
  ],
  [
    "diff-backgrounds",
    retainAcepeGeometry(
      "Acepe's diff-background toggle has no extracted Linear component or same-control binding.",
      [],
    ),
  ],
  [
    "diff-bars",
    retainAcepeGeometry(
      "Acepe's diff indicator-bars option has no extracted Linear component or same-control binding.",
      [],
    ),
  ],
  [
    "diff-classic",
    retainAcepeGeometry(
      "Acepe's classic diff-indicator option has no extracted Linear component or same-control binding.",
      [],
    ),
  ],
  [
    "diff-line-numbers",
    retainAcepeGeometry(
      "Acepe's diff line-number toggle has no extracted Linear component or same-control binding.",
      [],
    ),
  ],
  [
    "diff-wrapping",
    retainAcepeGeometry(
      "Acepe's diff wrapping toggle has no extracted Linear component or same-control binding.",
      ["TextParagraph"],
    ),
  ],
  [
    "dock",
    retainAcepeGeometry(
      "Linear's tab controls do not represent Acepe's dock/undock action.",
      ["OpenTabIcon", "CloseTabsIcon"],
    ),
  ],
  [
    "drag",
    retainAcepeGeometry(
      "No self-contained reusable drag-handle icon was extracted from the reviewed Linear corpus.",
      [],
    ),
  ],
  [
    "empty",
    retainAcepeGeometry(
      "Linear's EmptyCircle decorative sprite has no traced binding to Acepe's generic empty state.",
      ["EmptyCircle"],
    ),
  ],
  [
    "first",
    retainAcepeGeometry(
      "No Linear first-item or jump-to-first component was found in the reviewed corpus.",
      [],
    ),
  ],
  [
    "flask",
    retainAcepeGeometry(
      "No Linear experimental/flask control component was found in the reviewed corpus.",
      [],
    ),
  ],
  [
    "folder",
    retainAcepeGeometry(
      "Linear's Folder sprite is decorative/base inventory and NewFolderIcon is an add-folder control; neither proves Acepe's generic folder control.",
      ["Folder", "NewFolderIcon"],
    ),
  ],
  [
    "format",
    retainAcepeGeometry(
      "Acepe uses this for word-versus-character diff formatting; Linear has no same-control icon.",
      ["TextBlock", "TextParagraph"],
    ),
  ],
  [
    "git-diff-unified",
    retainAcepeGeometry(
      "Linear exports SplitColumnsIcon for split view but no unified-diff counterpart.",
      ["SplitColumnsIcon"],
    ),
  ],
  [
    "git",
    retainAcepeGeometry(
      "Linear provides GitHub, GitLab, and branch-action icons but no provider-neutral Git glyph.",
      ["GitHub", "GitLab", "CopyGitBranchNameIcon"],
    ),
  ],
  [
    "google-drive",
    retainAcepeGeometry(
      "No Google Drive brand glyph was extracted from the reviewed Linear corpus.",
      [],
    ),
  ],
  [
    "graduation",
    retainAcepeGeometry(
      "No graduation or learning control component was found in the reviewed Linear corpus.",
      [],
    ),
  ],
  [
    "hand",
    retainAcepeGeometry(
      "No traced Linear hand control matches Acepe's hand interaction state.",
      ["Hand"],
    ),
  ],
  [
    "heart-filled",
    retainAcepeGeometry(
      "Linear has only an unbound decorative Heart sprite, not Acepe's filled/unfilled paired control.",
      ["Heart"],
    ),
  ],
  [
    "heart",
    retainAcepeGeometry(
      "Linear's Heart sprite has no traced same-control binding and no matching outline state.",
      ["Heart"],
    ),
  ],
  [
    "info",
    retainAcepeGeometry(
      "No reusable InfoIcon or same-control informational glyph was found in the reviewed Linear corpus.",
      ["QuestionMark", "Alert"],
    ),
  ],
  [
    "keyboard",
    retainAcepeGeometry(
      "Linear's CommandIcon represents the Command key, not Acepe's keyboard-input and answer-needed controls.",
      ["CommandIcon"],
    ),
  ],
  [
    "laptop",
    retainAcepeGeometry(
      "Linear's DesktopWindow sprite is a browser window, not a laptop device.",
      ["DesktopWindow"],
    ),
  ],
  [
    "log",
    retainAcepeGeometry(
      "No provider-neutral log-file control icon was found in the reviewed Linear corpus.",
      ["Page", "DocumentHistoryIcon"],
    ),
  ],
  [
    "macbook",
    retainAcepeGeometry(
      "No MacBook device glyph or same-control binding was found in the reviewed Linear corpus.",
      ["DesktopWindow", "Apple"],
    ),
  ],
  [
    "mcp",
    retainAcepeGeometry(
      "The reviewed Linear catalog has no MCP control binding; the generic Server sprite is only decorative and must not stand in for Acepe's MCP server row.",
      ["Server"],
    ),
  ],
  [
    "microphone",
    retainAcepeGeometry(
      "No reusable microphone or voice-input icon was found in the reviewed Linear corpus.",
      [],
    ),
  ],
  [
    "notebook",
    retainAcepeGeometry(
      "Linear's NotePad sprite includes edit-pencil meaning and has no binding to Acepe's notebook/read control.",
      ["NotePad"],
    ),
  ],
  [
    "paged",
    retainAcepeGeometry(
      "Linear's Page sprite means a document, not Acepe's paged-layout mode.",
      ["Page"],
    ),
  ],
  [
    "phone",
    retainAcepeGeometry(
      "Linear's Phone decorative sprite is a call handset with no binding to Acepe's phone-device state.",
      ["Phone", "MobilePhone"],
    ),
  ],
  [
    "pop",
    retainAcepeGeometry(
      "No Linear pop-out control matches this Acepe runtime meaning; open-window actions use a different explicit icon.",
      ["OpenInNewWindowIcon"],
    ),
  ],
  [
    "realtime",
    retainAcepeGeometry(
      "No reusable Linear real-time/live activity glyph was extracted; runtime progress renderers were classified separately.",
      ["Bolt"],
    ),
  ],
  [
    "referral",
    retainAcepeGeometry(
      "No referral or invite-reward control component was found in the reviewed Linear corpus.",
      [],
    ),
  ],
  [
    "share",
    retainAcepeGeometry(
      "No reusable ShareIcon or same-control binding was found in the reviewed Linear corpus.",
      [],
    ),
  ],
  [
    "settings",
    retainAcepeGeometry(
      "Linear settings-like glyphs are bound to UserSettings and RecurringIssueSettings controls, not Acepe's generic settings sections.",
      ["UserSettingsIcon", "RecurringIssueSettingsIcon"],
    ),
  ],
  [
    "sidebar",
    retainAcepeGeometry(
      "Linear distinguishes CustomizeSidebar and SidebarPanel controls; neither proves Acepe's sidebar toggle/runtime sidebar control.",
      ["CustomizeSidebarIcon", "SidebarPanelIcon"],
    ),
  ],
  [
    "sparkle",
    retainAcepeGeometry(
      "Linear contains decorative AI and magic-wand sprites, but none is bound to Acepe's generate-commit, skill, or what's-new controls.",
      ["MagicWand", "AiWriting", "WritingAI"],
    ),
  ],
  [
    "spinner",
    retainAcepeGeometry(
      "Linear loading indicators are runtime-generated animations excluded from reusable static icon extraction.",
      ["GridLoaderIcon"],
    ),
  ],
  [
    "sun",
    retainAcepeGeometry(
      "Linear's Sun sprite has no traced light-theme control binding in the reviewed corpus.",
      ["Sun"],
    ),
  ],
  [
    "tool-sql",
    retainAcepeGeometry(
      "Linear's Database sprite has no SQL-tool or same-control binding in the reviewed corpus.",
      ["Database"],
    ),
  ],
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
    state: "no-equivalent",
    renderOutcome: "retain-acepe-geometry",
    rationale:
      "The previous Linear mapping was invalidated. Acepe keeps its original geometry until this exact control is retraced in Linear with reproducible same-intent evidence.",
    rejectedLinearCandidates: [],
    evidenceSource: invalidatedRuntimeMappingReview,
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
