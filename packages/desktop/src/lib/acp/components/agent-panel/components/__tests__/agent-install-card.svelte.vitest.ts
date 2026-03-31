import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui", async () => ({
	LoadingIcon: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("@lucide/svelte/icons/chevron-down", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("$lib/components/theme/context.svelte.js", () => ({
	useTheme: () => ({ effectiveTheme: "dark" }),
}));

vi.mock("$lib/acp/constants/thread-list-constants.js", () => ({
	getAgentIcon: () => "/agent-icon.svg",
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

	it("renders the voice-style segmented download progress while installing", () => {
		const { container } = render(AgentInstallCard, {
			agentId: "copilot",
			agentName: "GitHub Copilot",
			stage: "Downloading runtime",
			progress: 0.5,
		});

		expect(container.querySelector(".voice-download-segments")).toBeTruthy();
		expect(container.querySelectorAll(".voice-download-segment")).toHaveLength(20);
		expect(container.querySelectorAll(".voice-download-segment.filled")).toHaveLength(10);
		expect(container.querySelector(".circular-progress")).toBeNull();
	});
});