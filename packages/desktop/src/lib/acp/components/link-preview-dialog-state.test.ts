import { describe, expect, it } from "bun:test";
import {
	getLinkPreviewDomain,
	getLinkPreviewErrorState,
	getLinkPreviewLoadedState,
	getLinkPreviewResetState,
	getLinkPreviewToolbarState,
} from "./link-preview-dialog-state.js";

describe("link preview dialog state", () => {
	it("extracts the hostname from valid URLs", () => {
		expect(getLinkPreviewDomain("https://example.com/docs?q=1")).toBe("example.com");
		expect(getLinkPreviewDomain("http://localhost:5173/path")).toBe("localhost");
	});

	it("uses the original text when URL parsing fails", () => {
		expect(getLinkPreviewDomain("not a url")).toBe("not a url");
	});

	it("builds reset, loaded, and error states", () => {
		expect(getLinkPreviewResetState()).toEqual({
			isLoading: true,
			loadError: false,
		});
		expect(getLinkPreviewLoadedState()).toEqual({
			isLoading: false,
			loadError: false,
		});
		expect(getLinkPreviewErrorState()).toEqual({
			isLoading: false,
			loadError: true,
		});
	});

	it("builds toolbar display state from URL and load state", () => {
		expect(
			getLinkPreviewToolbarState({
				currentUrl: "https://example.com/docs",
				isLoading: true,
				loadError: false,
			})
		).toEqual({
			domain: "example.com",
			status: "loading",
		});
		expect(
			getLinkPreviewToolbarState({
				currentUrl: "bad url",
				isLoading: false,
				loadError: true,
			})
		).toEqual({
			domain: "bad url",
			status: "error",
		});
		expect(
			getLinkPreviewToolbarState({
				currentUrl: "https://example.com/docs",
				isLoading: false,
				loadError: false,
			}).status
		).toBe("ready");
	});
});
