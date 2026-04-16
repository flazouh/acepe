import { describe, expect, it } from "vitest";

import { parseFetchResult } from "../parse-fetch-result.js";

describe("parseFetchResult", () => {
	it("normalizes plain string bodies", () => {
		const parsed = parseFetchResult("Fetched docs body");

		expect(parsed).toEqual({
			kind: "fetch",
			responseBody: "Fetched docs body",
			statusCode: null,
			headers: [],
			contentType: null,
		});
	});

	it("normalizes structured fetch metadata into response body, status code, and headers", () => {
		const parsed = parseFetchResult({
			statusCode: 200,
			responseBody: "<html>Hello</html>",
			headers: {
				"content-type": "text/html; charset=utf-8",
				"x-request-id": "req-123",
			},
		});

		expect(parsed).toEqual({
			kind: "fetch",
			responseBody: "<html>Hello</html>",
			statusCode: 200,
			headers: [
				{ name: "content-type", value: "text/html; charset=utf-8" },
				{ name: "x-request-id", value: "req-123" },
			],
			contentType: "text/html; charset=utf-8",
		});
	});

	it("stringifies structured response bodies when only object content is available", () => {
		const parsed = parseFetchResult({
			status: 201,
			body: {
				message: "created",
			},
			responseHeaders: [
				{ name: "content-type", value: "application/json" },
				["cache-control", "no-store"],
			],
		});

		expect(parsed).toEqual({
			kind: "fetch",
			responseBody: '{\n  "message": "created"\n}',
			statusCode: 201,
			headers: [
				{ name: "content-type", value: "application/json" },
				{ name: "cache-control", value: "no-store" },
			],
			contentType: "application/json",
		});
	});

	it("returns null for malformed values with no fetch semantics", () => {
		expect(parseFetchResult({ nope: true })).toBeNull();
		expect(parseFetchResult(["bad", "shape"])).toBeNull();
		expect(parseFetchResult(null)).toBeNull();
	});
});
