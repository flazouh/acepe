import { describe, expect, it } from "bun:test";
import { resolveContentBlockRouteState } from "./content-block-router-state.js";

const testFileSrcConverter = (path: string) =>
	`asset://localhost/${encodeURIComponent(path)}`;

describe("content-block-router-state", () => {
	it("returns explicit render data for valid text blocks", () => {
		const state = resolveContentBlockRouteState(
			{ type: "text", text: "hello" },
			testFileSrcConverter
		);

		expect(state).toEqual({
			type: "render",
			block: { type: "text", text: "hello" },
		});
	});

	it("preserves web image uris in render data", () => {
		const state = resolveContentBlockRouteState(
			{
				type: "image",
				data: "encoded",
				mimeType: "image/png",
				uri: "https://example.test/image.png",
			},
			testFileSrcConverter
		);

		expect(state).toEqual({
			type: "render",
			block: {
				type: "image",
				data: "encoded",
				mimeType: "image/png",
				uri: "https://example.test/image.png",
			},
		});
	});

	it("converts file image uris through the injected converter", () => {
		const state = resolveContentBlockRouteState(
			{
				type: "image",
				data: "encoded",
				mimeType: "image/png",
				uri: "/tmp/image.png",
			},
			testFileSrcConverter
		);

		expect(state).toEqual({
			type: "render",
			block: {
				type: "image",
				data: "encoded",
				mimeType: "image/png",
				uri: "asset://localhost/%2Ftmp%2Fimage.png",
			},
		});
	});

	it("returns invalid state for invalid blocks", () => {
		const state = resolveContentBlockRouteState({ type: "text" }, testFileSrcConverter);

		expect(state.type).toBe("invalid");
		if (state.type === "invalid") {
			expect(state.message).toContain("Invalid content block");
		}
	});
});
