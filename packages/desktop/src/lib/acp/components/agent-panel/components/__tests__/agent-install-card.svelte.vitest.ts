import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@acepe/ui")>();

	return {
		...actual,
		LoadingIcon: (await import("./fixtures/user-message-stub.svelte")).default,
	};
});

vi.mock("$lib/components/theme/context.svelte.js", () => ({
	useTheme: () => ({ effectiveTheme: "dark" }),
}));

vi.mock("$lib/components/ui/spinner/index.js", async () => ({
	Spinner: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../../agent-icon.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../../animated-chevron.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

import AgentInstallCard from "../agent-install-card.svelte";

describe("AgentInstallCard", () => {
	afterEach(() => {
		cleanup();
	});

	it("reports an indeterminate install with no percentage anywhere", () => {
		const { container } = render(AgentInstallCard, {
			agentId: "copilot",
			agentName: "GitHub Copilot",
		});

		// The install call is request/response and reports nothing between
		// start and finish, so the card must not draw a bar or a number. It
		// used to draw a 20-segment bar fed by a progress prop that only ever
		// held 0.
		expect(container.textContent).toContain("Setting up GitHub Copilot...");
		expect(container.querySelector('[data-install-state="indeterminate"]')).toBeTruthy();
		expect(container.querySelector('[role="progressbar"]')).toBeNull();
		expect(container.querySelector('[data-variant="downloadCompact"]')).toBeNull();
		expect(container.textContent).not.toMatch(/\d+\s*%/);
	});
});
