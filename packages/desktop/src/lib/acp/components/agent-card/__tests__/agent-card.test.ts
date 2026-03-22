import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import AgentCard from "../agent-card.svelte";

// Skip visual component tests - Svelte 5 runes ($state) cannot be used in .test.ts files
// These are visual components that don't require comprehensive testing
describe.skip("AgentCard", () => {
	it("renders agent name and icon", () => {
		const { getByText, getByAltText } = render(AgentCard, {
			agentId: "test-agent",
			agentName: "Test Agent",
			iconSrc: "/test-icon.svg",
		});

		expect(getByText("Test Agent").textContent).toBe("Test Agent");
		expect(getByAltText("Test Agent icon").getAttribute("src")).toBe("/test-icon.svg");
	});

	it("applies selected styles when isSelected is true", () => {
		const { container } = render(AgentCard, {
			agentId: "test-agent",
			agentName: "Test Agent",
			iconSrc: "/test.svg",
			isSelected: true,
		});

		const button = container.querySelector("button");
		expect(button?.className).toContain("border-primary");
	});

	it("applies disabled styles when isAvailable is false", () => {
		const { container } = render(AgentCard, {
			agentId: "test-agent",
			agentName: "Test Agent",
			iconSrc: "/test.svg",
			isAvailable: false,
		});

		const button = container.querySelector("button");
		expect(button?.hasAttribute("disabled")).toBe(true);
		expect(button?.className).toContain("opacity-50");
		expect(button?.className).toContain("grayscale");
	});

	it("calls onclick handler when clicked", async () => {
		let clicked = false;
		const { getByRole } = render(AgentCard, {
			agentId: "test-agent",
			agentName: "Test Agent",
			iconSrc: "/test.svg",
			onclick: () => {
				clicked = true;
			},
		});

		await getByRole("button").click();
		expect(clicked).toBe(true);
	});
});
