import { describe, expect, it } from "vitest";

describe("pricing FAQ comparison links", () => {
	it("only links competitor FAQs that have a verified public comparison page", async () => {
		const { pricingFaqItems } = await import("./faq.js");

		const comparisonFaqs = pricingFaqItems.filter((item) => item.comparisonLink !== null);

		expect(comparisonFaqs).toEqual([
			expect.objectContaining({
				q: "How is Acepe better than Superset?",
				comparisonLink: {
					href: "/compare/superset",
					label: "See Acepe vs Superset",
				},
			}),
			expect.objectContaining({
				q: "How is Acepe different from 1Code?",
				comparisonLink: {
					href: "/compare/1code",
					label: "See Acepe vs 1Code",
				},
			}),
			expect.objectContaining({
				q: "How does Acepe compare to T3?",
				comparisonLink: {
					href: "/compare/t3",
					label: "See Acepe vs T3",
				},
			}),
			expect.objectContaining({
				q: "How does Acepe compare to Conductor?",
				comparisonLink: {
					href: "/compare/conductor",
					label: "See Acepe vs Conductor",
				},
			}),
		]);
	});
});
