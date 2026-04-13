import { describe, expect, it } from "vitest";

import { canonicalizePathname, getLegacyLocaleRedirectPath } from "./locale-routing";

describe("locale routing", () => {
	it("canonicalizes trailing slashes for english routes", () => {
		expect(canonicalizePathname("/")).toBe("/");
		expect(canonicalizePathname("/blog")).toBe("/blog");
		expect(canonicalizePathname("/blog/")).toBe("/blog");
	});

	it("redirects locale-prefixed routes to english canonical paths", () => {
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/es"))).toBe("/");
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/es/"))).toBe("/");
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/es/blog"))).toBe("/blog");
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/es/blog/?ref=nav"))).toBe(
			"/blog?ref=nav"
		);
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/es//evil.com"))).toBe(
			"/evil.com"
		);
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/en/pricing"))).toBe(
			"/pricing"
		);
	});

	it("leaves non-locale routes alone", () => {
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/"))).toBeNull();
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/blog"))).toBeNull();
		expect(getLegacyLocaleRedirectPath(new URL("https://acepe.dev/enterprise"))).toBeNull();
	});
});
