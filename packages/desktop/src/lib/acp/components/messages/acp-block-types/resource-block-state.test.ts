import { describe, expect, it } from "bun:test";

import {
	buildResourceBlockDisplayState,
	buildResourceLinkBlockDisplayState,
} from "./resource-block-state.js";

describe("resource-block-state", () => {
	it("builds resource display state with text", () => {
		expect(
			buildResourceBlockDisplayState({
				uri: "file:///notes.md",
				text: "hello",
			})
		).toEqual({
			header: "Resource: file:///notes.md",
			text: "hello",
			hasText: true,
		});
	});

	it("builds resource display state without text", () => {
		expect(buildResourceBlockDisplayState({ uri: "file:///notes.md" })).toEqual({
			header: "Resource: file:///notes.md",
			text: undefined,
			hasText: false,
		});
	});

	it("builds resource link display state", () => {
		expect(
			buildResourceLinkBlockDisplayState({
				uri: "https://example.com",
				name: "Example",
				title: "Docs",
				description: "Read this",
			})
		).toEqual({
			uri: "https://example.com",
			name: "Example",
			title: "Docs",
			description: "Read this",
			hasTitle: true,
			hasDescription: true,
			openTarget: "_blank",
			openFeatures: "noopener,noreferrer",
		});
	});

	it("builds resource link state without optional text", () => {
		const state = buildResourceLinkBlockDisplayState({
			uri: "https://example.com",
			name: "Example",
		});

		expect(state.hasTitle).toBe(false);
		expect(state.hasDescription).toBe(false);
	});
});
