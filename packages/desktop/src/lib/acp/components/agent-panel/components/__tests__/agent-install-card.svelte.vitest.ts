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

	it("renders the voice-style segmented download progress while installing", () => {
		const { container } = render(AgentInstallCard, {
			agentId: "copilot",
			agentName: "GitHub Copilot",
			stage: "Downloading runtime",
			progress: 0.5,
		});

		// SegmentedProgressBar (variant "downloadCompact") renders the segments;
		// it replaced the old VoiceDownloadProgress component's dedicated
		// .voice-download-segment class names with tailwind-variants classes.
		const bar = container.querySelector('[data-variant="downloadCompact"]');
		const segments = container.querySelectorAll(
			'[data-variant="downloadCompact"] > div:nth-child(1) > div'
		);
		const filledSegments = Array.from(segments).filter((segment) =>
			segment.className.includes("segment-fill")
		);

		expect(bar).toBeTruthy();
		expect(segments).toHaveLength(20);
		expect(filledSegments).toHaveLength(10);
		expect(container.querySelector(".circular-progress")).toBeNull();
	});
});
