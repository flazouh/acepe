import type { LinearIconName } from "./linear-icon-catalog.js";

export type ConfirmedInterfaceIconMapping = {
  readonly linearName: LinearIconName;
  readonly surface: string;
  readonly controlLabel: string;
  readonly observedBuild: string;
  readonly observationMethod:
    | "macos-accessibility-and-screenshot"
    | "linear-bundle-semantic-export"
    | "linear-bundle-control-binding";
  readonly geometryHash: string;
  readonly sourceChunk: string;
  readonly sourceType: string;
  readonly sourceSet: "base" | "brands" | "decorative" | null;
  readonly originalName: string;
  readonly evidenceState: "approved";
  readonly categoryExceptionReason: string | null;
};
