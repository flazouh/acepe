import { describe, expect, it } from "bun:test";

import { deriveSignInCard } from "../sign-in-card.js";

const requirement = {
	agent: "Codex",
	instructions: "Complete the Codex sign-in in your terminal, then retry.",
};

describe("deriveSignInCard", () => {
	it("shows nothing when the panel has no sign-in requirement", () => {
		expect(deriveSignInCard({ requirement: null, signInMethod: { kind: "browser" } })).toBe(null);
	});

	it("offers the control when the backend can run that agent's login", () => {
		expect(deriveSignInCard({ requirement, signInMethod: { kind: "browser" } })).toEqual({
			message: requirement.instructions,
			canSignIn: true,
		});
	});

	it("offers no control for an agent the backend cannot sign in, and says what to run", () => {
		const card = deriveSignInCard({
			requirement: { agent: "OpenCode", instructions: "Sign in, then retry." },
			signInMethod: {
				kind: "manual",
				instructions: "OpenCode signs in from its own terminal prompt: run `opencode auth login`.",
			},
		});
		expect(card?.canSignIn).toBe(false);
		expect(card?.message).toContain("opencode auth login");
	});

	it("offers no control while the backend has not said what the agent supports", () => {
		expect(deriveSignInCard({ requirement, signInMethod: null })).toEqual({
			message: requirement.instructions,
			canSignIn: false,
		});
	});
});
