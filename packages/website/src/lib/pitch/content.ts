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
	"platform-neutral": ["title", "solution", "market-why-now", "ask"],
	"why-acepe-wins": [
		"title",
		"problem",
		"workflow-failures",
		"solution",
		"market-why-now",
		"traction",
		"team",
	],
	"team-workflow-wedge": ["business-model"],
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
			"A harness-neutral workspace for running, supervising, and shipping work from multiple coding agents at production quality.",
		body: [
			"Developers are already using multiple agents. The missing layer is the system that makes those agents observable, governable, and shippable.",
			"Acepe is built to own that operating layer without locking teams to one provider, one harness, or one future agent model.",
		],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "problem",
		title: "Problem",
		narrativeRole: "narrative",
		headline: "Multi-agent development is real, but the workflow around it is still brittle",
		summary:
			"Teams can launch many agents, but they still struggle to understand what is happening, what is blocked, and what is safe to ship.",
		body: [
			"When teams move beyond a single assistant, visibility breaks down across sessions, tools, and partial results.",
			"That lack of operating discipline turns agent output into more chaos instead of more throughput.",
		],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "workflow-failures",
		title: "Why current workflows fail",
		narrativeRole: "narrative",
		headline: "Today’s agent workflows are hard to govern under real production pressure",
		summary:
			"The moment work becomes parallel, long-running, or review-sensitive, teams lose the thread.",
		body: [
			"Operators jump between terminals, chats, and editors with no consistent view of ownership, attention, or decision state.",
			"The result is fragile handoffs, weak reviewability, and a higher chance that valuable work dies before it ships.",
		],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "solution",
		title: "Solution",
		narrativeRole: "narrative",
		headline: "Acepe gives teams one place to orchestrate serious agent work",
		summary:
			"It combines live session control, attention management, checkpoints, and structured context so parallel agent work remains actionable.",
		body: [
			"Instead of replacing every harness, Acepe becomes the operator surface above them.",
			"That lets teams benefit from the best available agents while keeping supervision, workflow control, and review discipline in one system.",
		],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "product",
		title: "Product",
		narrativeRole: "proof",
		headline: "Built for the real loop: launch, monitor, unblock, review, ship",
		summary:
			"Acepe brings side-by-side agents, attention queueing, checkpoints, and SQL Studio into one developer workspace.",
		body: [
			"The product is designed for developers who need many active sessions without losing confidence in what changed or why.",
			"If Acepe later ships a first-party agent, it strengthens the platform rather than narrowing it to one proprietary workflow.",
		],
		thesisBeats: ["platform-neutral", "first-party-agent-upside"],
	},
	{
		id: "market-why-now",
		title: "Market / Why now",
		narrativeRole: "narrative",
		headline: "The agent layer is fragmenting fast, and teams need a control plane",
		summary:
			"More models, more harnesses, and more agent-native workflows create demand for a platform that can sit above the churn.",
		body: [
			"The winning product does not need to guess the one true harness. It needs to become the durable operator layer as the ecosystem expands.",
			"Acepe is positioned to capture that shift because its value grows as the number of viable agents grows.",
		],
		thesisBeats: ["platform-neutral", "why-acepe-wins", "why-now-urgency"],
	},
	{
		id: "traction",
		title: "Traction",
		narrativeRole: "proof",
		headline: "Early proof should stay honest while the public story matures",
		summary:
			"The pitch can show product energy now without pretending every growth metric is finalized and investor-ready.",
		body: [
			"We can lead with clear product differentiation and early community response while keeping dated quantitative proof disciplined.",
			"As stronger verified metrics arrive, the same content model can upgrade from qualitative proof to dated public evidence.",
		],
		thesisBeats: ["why-acepe-wins"],
		proofItems: [
			{
				kind: "qualitative",
				label: "Early traction",
				text: "Early traction is strongest as qualitative proof until dated public metrics are finalized.",
			},
			{
				kind: "estimated_numeric",
				label: "Community signal",
				value: "41",
				unit: "GitHub stars",
				estimateLabel: "estimate",
				note: "Public repo signal shown with explicit estimate labeling until verification is locked.",
			},
		],
	},
	{
		id: "business-model",
		title: "Business model",
		narrativeRole: "proof",
		headline: "Keep solo adoption generous, then monetize team-managed agent workflows",
		summary:
			"The first paid wedge is not raw access to one model. It is the workflow layer teams need once multiple agents become operationally important.",
		body: [
			"Free and local usage can stay broad to maximize adoption and ecosystem fit.",
			"Paid expansion comes from shared visibility, approvals, coordination, auditability, and enterprise controls around agent work.",
		],
		thesisBeats: ["team-workflow-wedge", "first-party-agent-upside"],
	},
	{
		id: "team",
		title: "Team",
		narrativeRole: "closing",
		headline: "The team is building from firsthand pain, not a hypothetical workflow",
		summary:
			"Acepe is grounded in the daily reality of managing agent-heavy software work, which sharpens both product intuition and velocity.",
		body: [
			"That proximity matters because the product category is still forming and requires tight iteration on real operator needs.",
			"Investors are backing a team with a concrete point of view on where agentic development is going.",
		],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "ask",
		title: "Ask",
		narrativeRole: "closing",
		headline:
			"The raise accelerates the control plane for the next generation of software development",
		summary:
			"Capital lets Acepe turn a sharp product point of view into a faster product, stronger workflow depth, and clearer go-to-market proof.",
		body: [
			"The raise unlocks faster productization of the operator layer, stronger team features, and more durable proof around adoption and retention.",
			"The goal is to win the platform layer while the ecosystem is still open and before one harness becomes the accidental default.",
		],
		thesisBeats: ["raise-unlock", "platform-neutral"],
	},
]);

export type { PitchProofItem, PitchSection } from "./types.js";
