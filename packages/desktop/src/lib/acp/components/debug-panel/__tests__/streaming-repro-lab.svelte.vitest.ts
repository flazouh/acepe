import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const storageMock: Storage = {
	length: 0,
	clear: () => undefined,
	getItem: () => null,
	key: () => null,
	removeItem: () => undefined,
	setItem: () => undefined,
};

Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: storageMock,
});
Object.defineProperty(globalThis, "sessionStorage", {
	configurable: true,
	value: storageMock,
});

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("$lib/acp/components/agent-panel/components/scene-content-viewport.svelte", async () => ({
	default: (
		await import(
			"$lib/acp/components/agent-panel/components/__tests__/fixtures/virtualized-entry-list-stub.svelte"
		)
	).default,
}));

vi.mock("$lib/acp/components/agent-panel/components/project-selection-panel.svelte", async () => ({
	default: (
		await import(
			"$lib/acp/components/agent-panel/components/__tests__/fixtures/user-message-stub.svelte"
		)
	).default,
}));

vi.mock(
	"$lib/acp/components/agent-panel/components/ready-to-assist-placeholder.svelte",
	async () => ({
		default: (
			await import(
				"$lib/acp/components/agent-panel/components/__tests__/fixtures/user-message-stub.svelte"
			)
		).default,
	})
);

import { createStreamingReproController } from "../streaming-repro-controller";
import StreamingReproLab from "../streaming-repro-lab.svelte";

type StreamingReproPerfProbeForTest = () => Promise<{
	readonly presetId: string;
	readonly phaseCount: number;
	readonly totalMs: number;
	readonly visibilityState: string;
	readonly documentHasFocus: boolean | null;
	readonly steps: readonly {
		readonly phaseId: string;
		readonly assistantTextLength: number;
	}[];
}>;

describe("StreamingReproLab", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders the lab as a simple one-button visual stepper", () => {
		const controller = createStreamingReproController({
			now: () => 10_000,
			hostMetrics: { width: 1280, height: 820 },
			theme: "dark",
		});

		const view = render(StreamingReproLab, { controller });

		expect(view.getByTestId("streaming-repro-lab")).toBeTruthy();
		expect(view.getByText(/Agent is preparing/)).toBeTruthy();
		expect(view.getByTestId("virtualized-entry-list-stub")).toBeTruthy();
		expect(view.getAllByRole("button")).toHaveLength(1);
		expect(view.getByRole("button", { name: "Next" })).toBeTruthy();
	});

	it("advances phases through the next button", async () => {
		const controller = createStreamingReproController({
			now: () => 11_000,
			hostMetrics: { width: 1280, height: 820 },
			theme: "dark",
		});

		const view = render(StreamingReproLab, { controller });

		await fireEvent.click(view.getByText("Next"));

		expect(controller.activePhase.id).toBe("assistant-part-1");
		expect(view.getByText(/First words arrive/)).toBeTruthy();
		expect(view.getByTestId("virtualized-entry-list-stub").dataset.rowCount).toBe("2");
		expect(view.getByTestId("virtualized-entry-list-stub-assistant").textContent).toContain(
			"Umbrellas"
		);
	});

	it("grows the same assistant row across next clicks", async () => {
		const controller = createStreamingReproController({
			now: () => 13_000,
			hostMetrics: { width: 1280, height: 820 },
			theme: "dark",
		});

		const view = render(StreamingReproLab, { controller });

		await fireEvent.click(view.getByText("Next"));
		const firstText = view.getByTestId("virtualized-entry-list-stub-assistant").textContent ?? "";

		await fireEvent.click(view.getByText("Next"));
		const secondText = view.getByTestId("virtualized-entry-list-stub-assistant").textContent ?? "";

		expect(controller.activePhase.id).toBe("assistant-part-2");
		expect(secondText.length).toBeGreaterThan(firstText.length);
		expect(secondText.startsWith(firstText)).toBe(true);
	});

	it("exposes a perf probe that measures each streaming phase flush", async () => {
		const controller = createStreamingReproController({
			now: () => 14_000,
			hostMetrics: { width: 1280, height: 820 },
			theme: "dark",
		});

		render(StreamingReproLab, { controller });

		const perfWindow = window as Window & {
			readonly __acepeStreamingReproPerfProbe?: StreamingReproPerfProbeForTest;
		};
		const perfProbe = perfWindow.__acepeStreamingReproPerfProbe;
		expect(typeof perfProbe).toBe("function");
		if (typeof perfProbe !== "function") {
			throw new Error("Expected streaming repro perf probe to be installed");
		}

		const result = await perfProbe();

		expect(result.presetId).toBe("core-streaming");
		expect(result.phaseCount).toBe(controller.activePreset.phases.length);
		expect(result.steps).toHaveLength(controller.activePreset.phases.length);
		expect(result.steps.at(-1)?.phaseId).toBe("assistant-complete");
		expect(result.steps.at(-1)?.assistantTextLength).toBeGreaterThan(0);
	});

	it("cycles back to the first phase from the final step", async () => {
		const controller = createStreamingReproController({
			now: () => 12_000,
			hostMetrics: { width: 1280, height: 820 },
			theme: "dark",
		});

		const view = render(StreamingReproLab, { controller });

		for (let index = 0; index < controller.activePreset.phases.length; index += 1) {
			await fireEvent.click(view.getByText("Next"));
		}

		expect(controller.activePhase.id).toBe("thinking-only");
		expect(view.getByText(/Agent is preparing/)).toBeTruthy();
	});
});
