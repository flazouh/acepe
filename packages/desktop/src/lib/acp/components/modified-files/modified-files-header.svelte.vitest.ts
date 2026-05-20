import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import type { FileReviewStatus } from "../review-panel/review-session-state.js";

interface ReviewHeaderMockState {
	readonly sessionLoaded: boolean;
	readonly reviewStatuses: ReadonlyMap<string, FileReviewStatus | undefined>;
	readonly keepAllApplied: boolean;
}

declare global {
	var modifiedFilesHeaderMockState: ReviewHeaderMockState | undefined;
}

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("../../store/merge-strategy-store.svelte.js", () => ({
	mergeStrategyStore: {
		set: vi.fn(),
	},
}));

vi.mock("../../store/agent-model-preferences-store.svelte.js", () => ({
	getPrGenerationPrefs: () => ({
		agentId: null,
		modelId: null,
		customPrompt: null,
	}),
	getCachedModels: () => [],
	getCachedModelsDisplay: () => null,
	setPrGenerationPrefs: vi.fn(),
}));

vi.mock("../../store/review-preference-store.svelte.js", () => ({
	getReviewPreferenceStore: () => ({
		preferFullscreen: false,
	}),
}));

vi.mock("../../store/session-review-state-store.svelte.js", () => ({
	sessionReviewStateStore: {
		isLoaded: () => globalThis.modifiedFilesHeaderMockState?.sessionLoaded ?? false,
		ensureLoaded: vi.fn(),
		getState: () => null,
		upsertFileProgress: vi.fn(),
	},
}));

vi.mock("./logic/keep-all-review-progress.js", () => ({
	buildKeepAllReviewEntries: () => [],
}));

vi.mock("./logic/build-pr-prompt-preview.js", () => ({
	DEFAULT_SHIP_INSTRUCTIONS: "Default ship instructions",
	normalizeCustomShipInstructions: (value: string | null | undefined) => value?.trim() ?? "",
}));

vi.mock("./logic/pr-generation-preferences.js", () => ({
	buildPrGenerationPrefsForAgentSelection: vi.fn(),
	buildPrGenerationRequestConfig: vi.fn(),
	getValidPrGenerationModelId: () => null,
}));

vi.mock("./logic/review-progress.js", () => ({
	getReviewStatusByFilePath: () =>
		globalThis.modifiedFilesHeaderMockState?.reviewStatuses ??
		new Map<string, FileReviewStatus | undefined>(),
	hasKeepAllBeenApplied: () => globalThis.modifiedFilesHeaderMockState?.keepAllApplied ?? false,
}));

vi.mock("../../utils/string-formatting.js", () => ({
	capitalizeName: (value: string) => value,
}));

vi.mock("../model-selector-logic.js", () => ({
	getModelDisplayName: () => "Model",
}));

vi.mock("../pr-state-icon.svelte", async () => ({
	default: (await import("../pr-status-card/test-component-stub.svelte")).default,
}));

vi.mock("../selector-check.svelte", async () => ({
	default: (await import("../pr-status-card/test-component-stub.svelte")).default,
}));

vi.mock("../shared/pr-link-footer-button.svelte", async () => ({
	default: (await import("../pr-status-card/test-component-stub.svelte")).default,
}));

import ModifiedFilesHeader from "./modified-files-header.svelte";

beforeEach(() => {
	globalThis.modifiedFilesHeaderMockState = {
		sessionLoaded: false,
		reviewStatuses: new Map<string, FileReviewStatus | undefined>(),
		keepAllApplied: false,
	};
});

afterEach(() => {
	cleanup();
});

describe("ModifiedFilesHeader", () => {
	it("expands the file list when the trailing chevron control is clicked", async () => {
		const file = {
			filePath: "src/example.ts",
			fileName: "example.ts",
			totalAdded: 3,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const modifiedFilesState: ModifiedFilesState = {
			files: [file],
			byPath: new Map([[file.filePath, file]]),
			fileCount: 1,
			totalEditCount: 1,
		};

		render(ModifiedFilesHeader, {
			modifiedFilesState,
		});

		expect(screen.queryByText("example.ts")).toBeNull();

		await fireEvent.click(screen.getByRole("button", { name: /0\/1/i }));

		expect(screen.getByText("example.ts")).toBeTruthy();
	});

	it("locks the header to its intrinsic content width so the parent cannot squeeze actions", () => {
		const file = {
			filePath: "src/example.ts",
			fileName: "example.ts",
			totalAdded: 3,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const modifiedFilesState: ModifiedFilesState = {
			files: [file],
			byPath: new Map([[file.filePath, file]]),
			fileCount: 1,
			totalEditCount: 1,
		};

		const { container } = render(ModifiedFilesHeader, {
			modifiedFilesState,
		});

		const headerRow = container.querySelector(".min-w-max");
		if (!(headerRow instanceof HTMLDivElement)) {
			throw new Error("Missing modified-files header row");
		}

		const [leadingContainer, trailingContainer] = Array.from(headerRow.children);
		if (!(leadingContainer instanceof HTMLDivElement)) {
			throw new Error("Missing leading container");
		}
		if (!(trailingContainer instanceof HTMLDivElement)) {
			throw new Error("Missing trailing container");
		}

		expect(headerRow.className).toContain("min-w-max");
		expect(headerRow.className).not.toContain("flex-wrap");
		expect(leadingContainer.className).toContain("shrink-0");
		expect(leadingContainer.className).not.toContain("flex-wrap");
		expect(leadingContainer.className).not.toContain("min-w-0");
		expect(leadingContainer.className).not.toContain("overflow-hidden");
		expect(trailingContainer.className).toContain("shrink-0");
		expect(trailingContainer.className).toContain("ml-auto");
	});

	it("keeps the Open PR action group at its intrinsic width without truncation", () => {
		const file = {
			filePath: "src/example.ts",
			fileName: "example.ts",
			totalAdded: 3,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const modifiedFilesState: ModifiedFilesState = {
			files: [file],
			byPath: new Map([[file.filePath, file]]),
			fileCount: 1,
			totalEditCount: 1,
		};

		render(ModifiedFilesHeader, {
			modifiedFilesState,
			onCreatePr: vi.fn(),
		});

		const openPrButton = screen.getByRole("button", { name: /open pr/i });
		const openPrGroup = openPrButton.parentElement;
		if (!(openPrGroup instanceof HTMLDivElement)) {
			throw new Error("Missing Open PR action group");
		}

		expect(openPrGroup.className).toContain("shrink-0");
		expect(openPrGroup.className).not.toContain("flex-wrap");
		expect(openPrGroup.className).not.toContain("min-w-0");
		expect(openPrGroup.className).not.toContain("overflow-hidden");
		expect(openPrButton.className).not.toContain("min-w-0");
		expect(openPrButton.className).not.toContain("truncate");
	});

	it("routes Review clicks to the dialog opener instead of panel review mode when provided", async () => {
		const file = {
			filePath: "src/example.ts",
			fileName: "example.ts",
			totalAdded: 3,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const modifiedFilesState: ModifiedFilesState = {
			files: [file],
			byPath: new Map([[file.filePath, file]]),
			fileCount: 1,
			totalEditCount: 1,
		};
		const openReviewDialog = vi.fn();
		const enterReviewMode = vi.fn();

		render(ModifiedFilesHeader, {
			modifiedFilesState,
			onOpenReviewDialog: openReviewDialog,
			onEnterReviewMode: enterReviewMode,
		});

		await fireEvent.click(screen.getByRole("button", { name: /review/i }));

		expect(openReviewDialog).toHaveBeenCalledWith(modifiedFilesState, 0);
		expect(enterReviewMode).not.toHaveBeenCalled();
	});

	it("marks the header reviewed when every file has a final review status but keep all was not applied", () => {
		const acceptedFile = {
			filePath: "src/accepted.ts",
			fileName: "accepted.ts",
			totalAdded: 3,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const deniedFile = {
			filePath: "src/denied.ts",
			fileName: "denied.ts",
			totalAdded: 4,
			totalRemoved: 2,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const modifiedFilesState: ModifiedFilesState = {
			files: [acceptedFile, deniedFile],
			byPath: new Map([
				[acceptedFile.filePath, acceptedFile],
				[deniedFile.filePath, deniedFile],
			]),
			fileCount: 2,
			totalEditCount: 2,
		};

		globalThis.modifiedFilesHeaderMockState = {
			sessionLoaded: true,
			reviewStatuses: new Map<string, FileReviewStatus | undefined>([
				[acceptedFile.filePath, "accepted"],
				[deniedFile.filePath, "denied"],
			]),
			keepAllApplied: false,
		};

		render(ModifiedFilesHeader, {
			modifiedFilesState,
			sessionId: "session-1",
		});

		const reviewedButton = screen.getByRole("button", { name: /reviewed/i });
		expect(reviewedButton).toBeInstanceOf(HTMLButtonElement);
		expect((reviewedButton as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByRole("button", { name: /^keep$/i })).toBeNull();
		expect(screen.getByRole("button", { name: /2\/2/i })).toBeTruthy();
	});

	it("does not count partial files as finished review work", () => {
		const partialFile = {
			filePath: "src/partial.ts",
			fileName: "partial.ts",
			totalAdded: 3,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const acceptedFile = {
			filePath: "src/accepted.ts",
			fileName: "accepted.ts",
			totalAdded: 2,
			totalRemoved: 1,
			originalContent: null,
			finalContent: null,
			editCount: 1,
		};
		const modifiedFilesState: ModifiedFilesState = {
			files: [partialFile, acceptedFile],
			byPath: new Map([
				[partialFile.filePath, partialFile],
				[acceptedFile.filePath, acceptedFile],
			]),
			fileCount: 2,
			totalEditCount: 2,
		};

		globalThis.modifiedFilesHeaderMockState = {
			sessionLoaded: true,
			reviewStatuses: new Map<string, FileReviewStatus | undefined>([
				[partialFile.filePath, "partial"],
				[acceptedFile.filePath, "accepted"],
			]),
			keepAllApplied: false,
		};

		render(ModifiedFilesHeader, {
			modifiedFilesState,
			sessionId: "session-1",
		});

		expect(screen.getByRole("button", { name: /^keep$/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /reviewed/i })).toBeNull();
		expect(screen.getByRole("button", { name: /1\/2/i })).toBeTruthy();
	});
});
