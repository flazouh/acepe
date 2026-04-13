import { readFile } from "node:fs/promises";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import {
	approvedPitchTitleHeadlines,
	formatPitchProofValue,
	type PitchProofItem,
	pitchBeatSectionIds,
	pitchSections,
	validatePitchSections,
} from "$lib/pitch/content.js";

const { default: Page } = await import("./+page.svelte");

describe("pitch route contract", () => {
	it("renders the canonical investor story in order with stable anchors", () => {
		const { body } = render(Page);
		const expectedOrder = [
			"title",
			"problem",
			"workflow-failures",
			"solution",
			"product",
			"market-why-now",
			"traction",
			"business-model",
			"team",
			"ask",
		] as const;

		expect(pitchSections.map((section) => section.id)).toEqual(expectedOrder);
		expect(body).toContain("data-pitch-root");

		const anchorPositions = expectedOrder.map((sectionId) => {
			const index = body.indexOf(`id="${sectionId}"`);
			expect(index).toBeGreaterThanOrEqual(0);
			return index;
		});

		expect(anchorPositions).toEqual([...anchorPositions].sort((left, right) => left - right));
	});

	it("keeps dedicated investor sections instead of collapsing key beats", () => {
		expect(approvedPitchTitleHeadlines).toContain(
			pitchSections.find((section) => section.id === "title")?.headline
		);
		expect(pitchSections.find((section) => section.id === "workflow-failures")?.title).toBe(
			"Why current workflows fail"
		);
		expect(pitchSections.find((section) => section.id === "market-why-now")?.title).toBe(
			"Market / Why now"
		);
		expect(pitchSections.find((section) => section.id === "business-model")?.title).toBe(
			"Business model"
		);
		expect(pitchSections.find((section) => section.id === "team")?.title).toBe("Team");
		expect(pitchSections.find((section) => section.id === "ask")?.title).toBe("Ask");
	});

	it("encodes the platform, monetization, and raise thesis in the content model", () => {
		const allBeats = new Set(pitchSections.flatMap((section) => section.thesisBeats));

		expect(allBeats.has("platform-neutral")).toBe(true);
		expect(allBeats.has("why-acepe-wins")).toBe(true);
		expect(allBeats.has("team-workflow-wedge")).toBe(true);
		expect(allBeats.has("raise-unlock")).toBe(true);
		expect(allBeats.has("why-now-urgency")).toBe(true);
		expect(
			pitchSections
				.find((section) => section.id === "business-model")
				?.thesisBeats.includes("team-workflow-wedge")
		).toBe(true);
		expect(
			pitchSections.find((section) => section.id === "ask")?.thesisBeats.includes("raise-unlock")
		).toBe(true);
		expect(pitchBeatSectionIds["why-now-urgency"]).toEqual(["market-why-now"]);
	});

	it("renders a readable label for every thesis beat used by the deck", () => {
		const { body } = render(Page);

		expect(body).toContain("Why now urgency");
	});

	it("falls back to qualitative proof when numeric evidence is not verified", () => {
		const proof: PitchProofItem = {
			kind: "qualitative",
			label: "Traction",
			text: "Early traction is strongest as qualitative proof until dated public metrics are finalized.",
		};

		expect(formatPitchProofValue(proof)).toBe(
			"Early traction is strongest as qualitative proof until dated public metrics are finalized."
		);
	});

	it("renders estimated numbers only when they are explicitly labeled as estimates", () => {
		const proof: PitchProofItem = {
			kind: "estimated_numeric",
			label: "Community signal",
			value: "41",
			unit: "GitHub stars",
			estimateLabel: "estimate",
		};

		expect(formatPitchProofValue(proof)).toBe("41 GitHub stars (estimate)");
	});

	it("fails loudly when the content contract is invalid", () => {
		expect(() =>
			validatePitchSections([
				{
					id: "title",
					title: "",
					narrativeRole: "hero",
					headline: "Broken section",
					summary: "This should fail",
					body: ["Missing title"],
					thesisBeats: ["platform-neutral"],
				},
			])
		).toThrow("Pitch sections must include a non-empty title for title");

		expect(() =>
			validatePitchSections([
				{
					id: "title",
					title: "Title",
					narrativeRole: "hero",
					headline: "First",
					summary: "One",
					body: ["One"],
					thesisBeats: ["platform-neutral"],
				},
				{
					id: "title",
					title: "Duplicate",
					narrativeRole: "narrative",
					headline: "Second",
					summary: "Two",
					body: ["Two"],
					thesisBeats: ["why-acepe-wins"],
				},
			])
		).toThrow("Pitch sections must use unique ids");
	});

	it("consumes the shared content model from the route instead of redefining sections inline", async () => {
		const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

		expect(source).toContain("from '$lib/pitch/content.js'");
		expect(source).toContain("pitchSections");
		expect(source).not.toContain("const localPitchSections =");
	});
});
