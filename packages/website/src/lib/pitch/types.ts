export const pitchSectionIds = [
	"title",
	"problem",
	"before-after",
	"solution",
	"traction",
	"product",
	"market-why-now",
	"competition",
	"business-model",
	"ask",
] as const;

export type PitchSectionId = (typeof pitchSectionIds)[number];

export const pitchNarrativeRoles = ["hero", "narrative", "proof", "closing"] as const;

export type PitchNarrativeRole = (typeof pitchNarrativeRoles)[number];

export const pitchThesisBeats = [
	"platform-neutral",
	"why-acepe-wins",
	"team-workflow-wedge",
	"raise-unlock",
	"first-party-agent-upside",
	"why-now-urgency",
] as const;

export type PitchThesisBeat = (typeof pitchThesisBeats)[number];

interface PitchProofItemBase {
	readonly label: string;
	readonly note?: string;
}

export interface VerifiedNumericPitchProofItem extends PitchProofItemBase {
	readonly kind: "verified_numeric";
	readonly value: string;
	readonly unit?: string;
	readonly verifiedAt: string;
	readonly sourceLabel: string;
	readonly sourceHref: string;
}

export interface EstimatedNumericPitchProofItem extends PitchProofItemBase {
	readonly kind: "estimated_numeric";
	readonly value: string;
	readonly unit?: string;
	readonly estimateLabel: string;
}

export interface QualitativePitchProofItem extends PitchProofItemBase {
	readonly kind: "qualitative";
	readonly text: string;
}

export type PitchProofItem =
	| VerifiedNumericPitchProofItem
	| EstimatedNumericPitchProofItem
	| QualitativePitchProofItem;

export interface PitchSection {
	readonly id: PitchSectionId;
	readonly title: string;
	readonly narrativeRole: PitchNarrativeRole;
	readonly headline: string;
	readonly summary: string;
	readonly body: readonly string[];
	readonly thesisBeats: readonly PitchThesisBeat[];
	readonly proofItems?: readonly PitchProofItem[];
}
