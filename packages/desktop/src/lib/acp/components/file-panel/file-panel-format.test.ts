import { describe, expect, it } from "bun:test";

import { parseTableContent } from "./format/parsers/delimited";
import { tryParseJsonString } from "./format/parsers/structured";
import { getDisplayOptions, getFormatKind, parseStructuredContent } from "./format/registry";

describe("getFormatKind", () => {
	it("detects markdown and mdx", () => {
		expect(getFormatKind("/repo/README.md")).toBe("markdown");
		expect(getFormatKind("/repo/guide.MDX")).toBe("mdx");
	});

	it("detects structured file types", () => {
		expect(getFormatKind("/repo/package.json")).toBe("json");
		expect(getFormatKind("/repo/config.yml")).toBe("yaml");
		expect(getFormatKind("/repo/layout.xml")).toBe("xml");
		expect(getFormatKind("/repo/app.toml")).toBe("toml");
		expect(getFormatKind("/repo/system.conf")).toBe("ini");
		expect(getFormatKind("/repo/.env.production")).toBe("env");
		expect(getFormatKind("/repo/session.jsonl")).toBe("ndjson");
		expect(getFormatKind("/repo/request.http")).toBe("http");
		expect(getFormatKind("/repo/Dockerfile")).toBe("dockerfile");
		expect(getFormatKind("/repo/.gitignore")).toBe("gitignore");
		expect(getFormatKind("/repo/pnpm-lock.yaml")).toBe("lockfile");
	});

	it("detects table and rendered file types", () => {
		expect(getFormatKind("/repo/users.csv")).toBe("csv");
		expect(getFormatKind("/repo/users.tsv")).toBe("tsv");
		expect(getFormatKind("/repo/server.log")).toBe("log");
		expect(getFormatKind("/repo/schema.sql")).toBe("sql");
		expect(getFormatKind("/repo/changes.patch")).toBe("diff");
		expect(getFormatKind("/repo/index.html")).toBe("html");
	});

	it("detects pdf files", () => {
		expect(getFormatKind("/repo/document.pdf")).toBe("pdf");
		expect(getFormatKind("/repo/report.PDF")).toBe("pdf");
	});

	it("falls back to other for unsupported files", () => {
		expect(getFormatKind("/repo/notes.txt")).toBe("other");
	});
});

describe("getDisplayOptions", () => {
	it("uses rendered mode by default for markdown-like preview files", () => {
		expect(getDisplayOptions("/repo/README.md")).toEqual({
			availableModes: ["rendered", "raw"],
			defaultMode: "rendered",
			formatKind: "markdown",
		});
		expect(getDisplayOptions("/repo/index.html")).toEqual({
			availableModes: ["rendered", "raw"],
			defaultMode: "rendered",
			formatKind: "html",
		});
	});

	it("uses structured mode for inspectable config/data files", () => {
		expect(getDisplayOptions("/repo/package.json")).toEqual({
			availableModes: ["structured", "raw"],
			defaultMode: "structured",
			formatKind: "json",
		});
		expect(getDisplayOptions("/repo/.env")).toEqual({
			availableModes: ["structured", "raw"],
			defaultMode: "structured",
			formatKind: "env",
		});
	});

	it("uses table mode for csv/tsv", () => {
		expect(getDisplayOptions("/repo/users.csv")).toEqual({
			availableModes: ["table", "raw"],
			defaultMode: "table",
			formatKind: "csv",
		});
		expect(getDisplayOptions("/repo/users.tsv")).toEqual({
			availableModes: ["table", "raw"],
			defaultMode: "table",
			formatKind: "tsv",
		});
	});

	it("uses rendered-only mode for pdf and image files", () => {
		expect(getDisplayOptions("/repo/document.pdf")).toEqual({
			availableModes: ["rendered"],
			defaultMode: "rendered",
			formatKind: "pdf",
		});
		expect(getDisplayOptions("/repo/photo.png")).toEqual({
			availableModes: ["rendered"],
			defaultMode: "rendered",
			formatKind: "image",
		});
	});

	it("uses raw mode only for unsupported formats", () => {
		expect(getDisplayOptions("/repo/main.ts")).toEqual({
			availableModes: ["raw"],
			defaultMode: "raw",
			formatKind: "other",
		});
	});
});

describe("parseTableContent", () => {
	it("parses csv rows", () => {
		const parsed = parseTableContent("name,age\nAlex,31\nSam,22", "csv");

		expect(parsed.isOk()).toBe(true);
		if (parsed.isOk()) {
			expect(parsed.value.headers).toEqual(["name", "age"]);
			expect(parsed.value.rows).toEqual([
				["Alex", "31"],
				["Sam", "22"],
			]);
		}
	});

	it("parses tsv rows", () => {
		const parsed = parseTableContent("name\tage\nAlex\t31\nSam\t22", "tsv");

		expect(parsed.isOk()).toBe(true);
		if (parsed.isOk()) {
			expect(parsed.value.headers).toEqual(["name", "age"]);
			expect(parsed.value.rows).toEqual([
				["Alex", "31"],
				["Sam", "22"],
			]);
		}
	});

	it("returns error for unclosed quoted value", () => {
		const parsed = parseTableContent('name,note\n"Alex,broken', "csv");

		expect(parsed.isErr()).toBe(true);
	});
});

describe("parseStructuredContent", () => {
	it("parses valid json", () => {
		const parsed = parseStructuredContent('{"name":"acepe","enabled":true}', "json");

		expect(parsed.isOk()).toBe(true);
		if (parsed.isOk()) {
			expect(parsed.value).toEqual({ name: "acepe", enabled: true });
		}
	});

	it("parses env-like files", () => {
		const parsed = parseStructuredContent("API_URL=https://x.dev\nFEATURE=true", "env");

		expect(parsed.isOk()).toBe(true);
		if (parsed.isOk()) {
			expect(parsed.value).toEqual({ API_URL: "https://x.dev", FEATURE: "true" });
		}
	});

	it("parses ndjson files", () => {
		const parsed = parseStructuredContent('{"a":1}\n{"b":2}', "ndjson");

		expect(parsed.isOk()).toBe(true);
		if (parsed.isOk()) {
			expect(parsed.value).toEqual([{ a: 1 }, { b: 2 }]);
		}
	});

	it("parses lockfile files", () => {
		const parsed = parseStructuredContent('{"name":"demo","lockfileVersion":3}', "lockfile");

		expect(parsed.isOk()).toBe(true);
		if (parsed.isOk()) {
			expect(parsed.value).toEqual({ name: "demo", lockfileVersion: 3 });
		}
	});

	it("returns error for invalid json", () => {
		const parsed = parseStructuredContent("{invalid", "json");

		expect(parsed.isErr()).toBe(true);
		if (parsed.isErr()) {
			expect(parsed.error.message).toContain("Invalid JSON");
		}
	});
});

describe("tryParseJsonString", () => {
	it("parses JSON objects", () => {
		expect(tryParseJsonString('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
	});

	it("parses JSON arrays", () => {
		expect(tryParseJsonString('[1,2,"a"]')).toEqual([1, 2, "a"]);
	});

	it("parses TOML inline table when JSON fails", () => {
		expect(tryParseJsonString('{ version = "2", features = [] }')).toEqual({
			version: "2",
			features: [],
		});
	});

	it("returns null for plain strings", () => {
		expect(tryParseJsonString("hello")).toBeNull();
		expect(tryParseJsonString("")).toBeNull();
	});
});
