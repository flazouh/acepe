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
	"The Agentic\nDeveloper Environment",
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
		headline: "The Agentic\nDeveloper Environment",
		summary:
			"One native workspace for every coding agent. Run them in parallel, review every change, and ship from plan to PR without leaving the window.",
		body: [
			"Developers already launch many agents. What's missing is one place to see what's happening, unblock what's stuck, and know what's safe to ship.",
			"Acepe is that place. It works with any model, provider, or agent harness.",
		],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "problem",
		title: "Problem",
		narrativeRole: "narrative",
		headline: "Launching agents is easy\nShipping their output is the bottleneck",
		summary:
			"Teams can run ten agents in parallel, then lose track of status, ownership, and what is actually safe to merge.",
		body: [
			"PRs pile up, context scatters across sessions, and nobody knows what needs attention next.",
			"More agents should mean more shipped code. Right now it just means more chaos.",
		],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "workflow-failures",
		title: "Why current workflows fail",
		narrativeRole: "narrative",
		headline: "Current tools break once agent work becomes parallel",
		summary:
			"Terminals and editors were built for one thread of work, not a fleet of long-running agents.",
		body: [
			"You end up bouncing between four tools with no shared view of what's blocked, what's risky, or what's ready.",
			"Handoffs get missed. Reviews get weaker. Good work stalls before it reaches main.",
		],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "solution",
		title: "Solution",
		narrativeRole: "narrative",
		headline: "Acepe gives teams one workspace to run and ship agent work",
		summary:
			"Attention queueing, checkpoints, and structured context. Many agents, one reviewable workflow.",
		body: [
			"Run Claude Code, Codex, Cursor, and any ACP agent side by side in one window.",
			"One place to see status, unblock work, review changes, and ship to main.",
		],
		thesisBeats: ["platform-neutral", "why-acepe-wins"],
	},
	{
		id: "product",
		title: "Product",
		narrativeRole: "proof",
		headline: "The real loop: launch, monitor, unblock, review, ship",
		summary:
			"Parallel sessions, attention queueing, and checkpoints in one native desktop workspace.",
		body: [
			"Built for developers juggling multiple agents, reviews, and half-finished outputs at once.",
			"A first-party agent adds upside later. The core value is the workflow around every agent.",
		],
		thesisBeats: ["platform-neutral", "first-party-agent-upside"],
	},
	{
		id: "market-why-now",
		title: "Market / Why now",
		narrativeRole: "narrative",
		headline: "Agent tooling is fragmenting fast\nThe workflow layer is still open",
		summary:
			"Claude Code, Codex, Cursor, Gemini, and open ACP agents are all growing. No one owns the workflow above them.",
		body: [
			"The winner doesn't pick one harness. It becomes the tool teams keep using as new agents show up.",
			"Every new viable agent makes Acepe more useful, not less.",
		],
		thesisBeats: ["platform-neutral", "why-acepe-wins", "why-now-urgency"],
	},
	{
		id: "traction",
		title: "Traction",
		narrativeRole: "proof",
		headline: "Developers are already showing up for the workflow",
		summary:
			"The product is live and public. People respond to multi-agent supervision and review in one place, not just model access.",
		body: [
			"We're early. But the signal is specific: what gets people interested is running many agents and shipping from one window.",
			"As usage numbers harden, this slide gets concrete metrics.",
		],
		thesisBeats: ["why-acepe-wins"],
		proofItems: [
			{
				kind: "qualitative",
				label: "Early traction",
				text: "Interest is strongest around multi-agent supervision and one-window shipping, not model access.",
			},
			{
				kind: "estimated_numeric",
				label: "GitHub signal",
				value: "77",
				unit: "GitHub stars",
				estimateLabel: "estimate",
				note: "Estimate shown until we update with a verified count.",
			},
		],
	},
	{
		id: "business-model",
		title: "Business model",
		narrativeRole: "proof",
		headline: "Free for solo\nPaid for team workflow\nEnterprise for control",
		summary:
			"The paid wedge isn't model access. It's what teams need once they're running many agents at once.",
		body: [
			"Solo and local use stay free. We want Acepe to be where agent-heavy development happens by default.",
			"Teams pay for shared visibility, approvals, handoff, audit trails, SSO, and remote execution.",
		],
		thesisBeats: ["team-workflow-wedge", "first-party-agent-upside"],
	},
	{
		id: "team",
		title: "Team",
		narrativeRole: "closing",
		headline: "We built this because we needed it",
		summary:
			"Acepe comes from running many coding agents every day and getting frustrated with the workflow around them.",
		body: [
			"The category is still forming. What matters now is tight product judgment from people who live the problem.",
			"We're building from daily use, not from a thesis about what developers might eventually want.",
		],
		thesisBeats: ["why-acepe-wins"],
	},
	{
		id: "ask",
		title: "Ask",
		narrativeRole: "closing",
		headline: "This raise makes Acepe the default workspace for agent-heavy teams",
		summary:
			"Capital goes to product depth, team features, and getting in front of engineering teams while the market is open.",
		body: [
			"Use of funds: deeper team workflow, remote agent execution, and focused go-to-market with engineering orgs.",
			"The window is now. Agent tooling is growing fast, and nobody owns the workflow layer yet.",
		],
		thesisBeats: ["raise-unlock", "platform-neutral"],
	},
]);

export type { PitchProofItem, PitchSection } from "./types.js";
