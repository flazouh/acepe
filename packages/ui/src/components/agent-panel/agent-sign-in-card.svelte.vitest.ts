import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentSignInCard from "./agent-sign-in-card.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("AgentSignInCard", () => {
	it("offers a sign-in action", async () => {
		const onSignIn = vi.fn();
		const view = render(AgentSignInCard, {
			props: {
				title: "Sign in to continue",
				message: "Cursor needs authentication.",
				onSignIn,
			},
		});

		await fireEvent.click(view.getByRole("button", { name: "Sign in" }));

		expect(onSignIn).toHaveBeenCalledTimes(1);
	});

	it("shows cancellable busy state without allowing another sign-in", async () => {
		const onSignIn = vi.fn();
		const onCancelSignIn = vi.fn();
		const view = render(AgentSignInCard, {
			props: {
				title: "Sign in to continue",
				message: "Cursor needs authentication.",
				onSignIn,
				onCancelSignIn,
				isSigningIn: true,
			},
		});

		expect(view.getByRole("button", { name: "Signing in…" }).hasAttribute("disabled")).toBe(true);
		await fireEvent.click(view.getByRole("button", { name: "Cancel" }));
		expect(onCancelSignIn).toHaveBeenCalledTimes(1);
		expect(view.getByTestId("agent-sign-in-card").getAttribute("aria-busy")).toBe("true");
	});

	it("announces a recoverable sign-in error", () => {
		const view = render(AgentSignInCard, {
			props: {
				title: "Sign in to continue",
				message: "Cursor needs authentication.",
				onSignIn: vi.fn(),
				signInError: "Sign-in was cancelled.",
			},
		});

		const status = view.getByRole("status");
		expect(status.textContent).toContain("Sign-in was cancelled.");
		expect(status.getAttribute("aria-live")).toBe("polite");
	});
});
