export type InterfaceWrapperNoEquivalentName =
	| "google-logo"
	| "menu"
	| "storage"
	| "x-logo";

export type InterfaceWrapperNoEquivalentDecision = {
	readonly state: "no-equivalent";
	readonly renderOutcome: "retain-custom-wrapper";
	readonly rationale: string;
	readonly rejectedLinearCandidates: readonly string[];
	readonly evidenceSource: string;
};

const reviewedCorpus =
	"Linear 1.31.1 cache corpus 515153e5d010d576789d34a88a2a6ef3d596ac537caf8de2d1e14b2d820b977c";

function retainCustomWrapper(
	rationale: string,
	rejectedLinearCandidates: readonly string[],
): InterfaceWrapperNoEquivalentDecision {
	return {
		state: "no-equivalent",
		renderOutcome: "retain-custom-wrapper",
		rationale,
		rejectedLinearCandidates,
		evidenceSource: reviewedCorpus,
	};
}

export const interfaceWrapperMigrationManifest = new Map<
	InterfaceWrapperNoEquivalentName,
	InterfaceWrapperNoEquivalentDecision
>([
	[
		"google-logo",
		retainCustomWrapper(
			"Linear exposes Google Play, not the multicolor Google brand/logo used by Acepe's GoogleLogoIcon wrapper.",
			["GooglePlay"],
		),
	],
	[
		"menu",
		retainCustomWrapper(
			"Linear's menu-like extracted control is a focus/order menu feature glyph, not Acepe's generic hamburger menu trigger.",
			["FocusIcon", "FeatureSvg7310d057bc00Icon"],
		),
	],
	[
		"storage",
		retainCustomWrapper(
			"Acepe StorageIcon is a storage stack wrapper. Linear's Server and Database glyphs are separate infrastructure/data concepts and should not replace it by visual similarity.",
			["Server", "Database"],
		),
	],
	[
		"x-logo",
		retainCustomWrapper(
			"The reviewed Linear catalog has no X/Twitter brand glyph. Acepe's XLogoIcon remains custom for X social links.",
			[],
		),
	],
]);

export function getInterfaceWrapperMigrationDecision(
	name: InterfaceWrapperNoEquivalentName,
): InterfaceWrapperNoEquivalentDecision {
	const decision = interfaceWrapperMigrationManifest.get(name);
	if (decision === undefined) {
		throw new Error(`Missing interface wrapper migration decision for ${name}`);
	}
	return decision;
}
