import {
	type PitchProofItem,
	type PitchSection,
	type PitchThesisBeat,
	pitchSectionIds,
} from "./types.js";

const requiredPitchThesisBeats: readonly PitchThesisBeat[] = [
	"platform-neutral",
	"why-acepe-wins",
	"team-workflow-wedge",
	"raise-unlock",
	"why-now-urgency",
];

export const approvedPitchTitleHeadlines = [
	"Acepe is the operating layer for agentic development",
] as const;

export const pitchBeatSectionIds = {
	"platform-neutral": ["title", "solution", "product", "competition", "ask"],
	"why-acepe-wins": [
		"title",
		"problem",
		"before-after",
		"solution",
		"traction",
		"competition",
		"ask",
	],
	"team-workflow-wedge": ["market-why-now", "business-model"],
	"raise-unlock": ["ask"],
	"first-party-agent-upside": ["product", "business-model"],
	"why-now-urgency": ["market-why-now"],
} as const;

function assertNonEmptyValue(value: string, fieldName: string, sectionId: string): void {
	if (value.trim().length === 0) {
		throw new Error(`Pitch sections must include a non-empty ${fieldName} for ${sectionId}`);
	}
}

export function validatePitchSections(sections: readonly PitchSection[]): readonly PitchSection[] {
	const seenIds = new Set<string>();

	for (const section of sections) {
		if (seenIds.has(section.id)) {
			throw new Error("Pitch sections must use unique ids");
		}

		seenIds.add(section.id);
		assertNonEmptyValue(section.title, "title", section.id);
		assertNonEmptyValue(section.headline, "headline", section.id);
		assertNonEmptyValue(section.summary, "summary", section.id);

		if (section.body.length === 0) {
			throw new Error(`Pitch sections must include at least one body paragraph for ${section.id}`);
		}
	}

	return sections;
}

function createPitchSections(sections: readonly PitchSection[]): readonly PitchSection[] {
	const validatedSections = validatePitchSections(sections);
	const sectionIds = validatedSections.map((section) => section.id);
	const missingThesisBeats = requiredPitchThesisBeats.filter((beat) => {
		return !validatedSections.some((section) => section.thesisBeats.includes(beat));
	});
	const titleSection = validatedSections[0];

	if (validatedSections.length !== pitchSectionIds.length) {
		throw new Error("Pitch deck must include the canonical ten sections");
	}

	if (sectionIds.join("|") !== pitchSectionIds.join("|")) {
		throw new Error("Pitch deck must preserve the canonical investor section order");
	}

	if (missingThesisBeats.length > 0) {
		throw new Error(
			`Pitch deck is missing required thesis beats: ${missingThesisBeats.join(", ")}`
		);
	}

	if (
		!approvedPitchTitleHeadlines.includes(
			titleSection.headline as (typeof approvedPitchTitleHeadlines)[number]
		)
	) {
		throw new Error("Pitch deck title headline must use an approved category-defining line");
	}

	for (const [beat, mappedSectionIds] of Object.entries(pitchBeatSectionIds)) {
		for (const mappedSectionId of mappedSectionIds) {
			const mappedSection = validatedSections.find((section) => section.id === mappedSectionId);

			if (!mappedSection) {
				throw new Error(`Pitch beat mapping references unknown section ${mappedSectionId}`);
			}

			if (!mappedSection.thesisBeats.includes(beat as PitchThesisBeat)) {
				throw new Error(`Pitch beat mapping requires ${beat} in ${mappedSectionId}`);
			}
		}
	}

	return validatedSections;
}

export function formatPitchProofValue(proofItem: PitchProofItem): string {
	if (proofItem.kind === "qualitative") {
		return proofItem.text;
	}

	const unitSuffix = proofItem.unit ? ` ${proofItem.unit}` : "";

	if (proofItem.kind === "estimated_numeric") {
		return `${proofItem.value}${unitSuffix} (${proofItem.estimateLabel})`;
	}

	return `${proofItem.value}${unitSuffix}`;
}

export const pitchSections = createPitchSections([
	{
		id: "title",
		title: "Title",
		narrativeRole: "hero",
		headline: "Acepe is the operating layer for agentic development",
		summary:
			"Run any coding agent in one workspace. Monitor, unblock, review, and ship with production discipline.",
		body: ["Multi-agent development is here.", "Acepe is the control plane above it."],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "problem",
		title: "Problem",
		narrativeRole: "narrative",
		headline: "Multi-agent development exists. The management layer does not.",
		summary:
			"Teams mix terminals, editors, and agents with no shared queue, review flow, or audit trail.",
		body: ["Blocked sessions go unseen.", "Conflicting edits surface too late."],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "before-after",
		title: "Before / After",
		narrativeRole: "narrative",
		headline: "Before: scattered terminals. After: one governed workflow.",
		summary: "Acepe replaces reactive babysitting with one reviewable execution loop.",
		body: ["Less context-switching.", "More reviewable output."],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "solution",
		title: "Solution",
		narrativeRole: "narrative",
		headline: "Acepe turns agent output into shippable work.",
		summary:
			"Harness-neutral desktop workspace for running, supervising, reviewing, and shipping agent work.",
		body: ["Attention queue + checkpoints.", "ACP keeps providers replaceable."],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "traction",
		title: "Traction",
		narrativeRole: "proof",
		headline: "Early demand is visible before launch.",
		summary:
			"Proof first: waitlist pull, open-source interest, and inbound users from founder-led distribution.",
		body: ["Users already arrive from X.", "The product is used daily."],
		thesisBeats: ["why-acepe-wins"],
		proofItems: [
			{
				kind: "qualitative",
				label: "Waitlist signups",
				text: "50",
				note: "Founder-managed list ahead of public launch",
			},
			{
				kind: "qualitative",
				label: "GitHub stars",
				text: "40",
				note: "Organic repo interest from product visibility",
			},
			{
				kind: "qualitative",
				label: "Agents connected",
				text: "3",
				note: "Claude Code, Codex, and Opencode live today",
			},
			{
				kind: "qualitative",
				label: "Prior founder customers",
				text: "100",
				note: "FluentAI paying customers, bootstrapped",
			},
		],
	},
	{
		id: "product",
		title: "Product",
		narrativeRole: "proof",
		headline: "Built for the real loop: launch, monitor, unblock, review, ship.",
		summary: "Native desktop workspace shipping today.",
		body: ["Parallel sessions, one queue.", "Checkpoint diffs before merge."],
		thesisBeats: ["platform-neutral", "first-party-agent-upside"],
	},
	{
		id: "market-why-now",
		title: "Market",
		narrativeRole: "narrative",
		headline: "Bottom-up: the first paid wedge is already large.",
		summary: "Acepe starts with team-governed agent work, not all developer tooling spend.",
		body: ["30M+ developers are adopting agents.", "The workflow is fragmenting now."],
		thesisBeats: ["platform-neutral", "why-now-urgency", "team-workflow-wedge"],
	},
	{
		id: "competition",
		title: "Competition",
		narrativeRole: "proof",
		headline: "Acepe owns the governed multi-agent quadrant.",
		summary:
			"Others optimize one agent, one editor, or post-hoc review. Acepe manages live multi-agent work.",
		body: ["Protocol-neutral by design.", "Governance is built in."],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "business-model",
		title: "Business model",
		narrativeRole: "proof",
		headline: "Free solo. Paid when teams need governance.",
		summary: "Adoption starts free. Revenue begins when teams need coordination and control.",
		body: ["Self-serve adoption pulls in developers.", "Team workflows create land-and-expand."],
		thesisBeats: ["team-workflow-wedge", "first-party-agent-upside"],
	},
	{
		id: "ask",
		title: "Team + Ask",
		narrativeRole: "closing",
		headline: "Founder-led, product-led, ready for pre-seed.",
		summary:
			"Back the founder, ship team workflows faster, and make Acepe the default operating layer.",
		body: [
			"Founder previously reached 100 paying customers.",
			"Raise funds team workflows, GTM, and remote agents.",
		],
		thesisBeats: ["raise-unlock", "platform-neutral", "why-acepe-wins"],
	},
]);

export type { PitchProofItem, PitchSection } from "./types.js";
