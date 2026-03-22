import { describe, expect, it } from "bun:test";

import {
	getFilePanelDisplayOptions,
	getFilePanelFormatKind,
	parseStructuredContent,
	parseTableContent,
	tryParseJsonString,
} from "./file-panel-format";

describe("getFilePanelFormatKind", () => {
	it("detects markdown and mdx", () => {
		expect(getFilePanelFormatKind("/repo/README.md")).toBe("markdown");
		expect(getFilePanelFormatKind("/repo/guide.MDX")).toBe("mdx");
	});

	it("detects structured file types", () => {
		expect(getFilePanelFormatKind("/repo/package.json")).toBe("json");
		expect(getFilePanelFormatKind("/repo/config.yml")).toBe("yaml");
		expect(getFilePanelFormatKind("/repo/layout.xml")).toBe("xml");
		expect(getFilePanelFormatKind("/repo/app.toml")).toBe("toml");
		expect(getFilePanelFormatKind("/repo/system.conf")).toBe("ini");
		expect(getFilePanelFormatKind("/repo/.env.production")).toBe("env");
		expect(getFilePanelFormatKind("/repo/session.jsonl")).toBe("ndjson");
		expect(getFilePanelFormatKind("/repo/request.http")).toBe("http");
		expect(getFilePanelFormatKind("/repo/Dockerfile")).toBe("dockerfile");
		expect(getFilePanelFormatKind("/repo/.gitignore")).toBe("gitignore");
		expect(getFilePanelFormatKind("/repo/pnpm-lock.yaml")).toBe("lockfile");
	});

	it("detects table and rendered file types", () => {
		expect(getFilePanelFormatKind("/repo/users.csv")).toBe("csv");
		expect(getFilePanelFormatKind("/repo/users.tsv")).toBe("tsv");
		expect(getFilePanelFormatKind("/repo/server.log")).toBe("log");
		expect(getFilePanelFormatKind("/repo/schema.sql")).toBe("sql");
		expect(getFilePanelFormatKind("/repo/changes.patch")).toBe("diff");
		expect(getFilePanelFormatKind("/repo/index.html")).toBe("html");
	});

	it("detects pdf files", () => {
		expect(getFilePanelFormatKind("/repo/document.pdf")).toBe("pdf");
		expect(getFilePanelFormatKind("/repo/report.PDF")).toBe("pdf");
	});

	it("falls back to other for unsupported files", () => {
		expect(getFilePanelFormatKind("/repo/notes.txt")).toBe("other");
	});
});

describe("getFilePanelDisplayOptions", () => {
	it("uses rendered mode by default for markdown-like preview files", () => {
		expect(getFilePanelDisplayOptions("/repo/README.md")).toEqual({
			availableModes: ["rendered", "raw"],
			defaultMode: "rendered",
			formatKind: "markdown",
		});
		expect(getFilePanelDisplayOptions("/repo/index.html")).toEqual({
			availableModes: ["rendered", "raw"],
			defaultMode: "rendered",
			formatKind: "html",
		});
	});

	it("uses structured mode for inspectable config/data files", () => {
		expect(getFilePanelDisplayOptions("/repo/package.json")).toEqual({
			availableModes: ["structured", "raw"],
			defaultMode: "structured",
			formatKind: "json",
		});
		expect(getFilePanelDisplayOptions("/repo/.env")).toEqual({
			availableModes: ["structured", "raw"],
			defaultMode: "structured",
			formatKind: "env",
		});
	});

	it("uses table mode for csv/tsv", () => {
		expect(getFilePanelDisplayOptions("/repo/users.csv")).toEqual({
			availableModes: ["table", "raw"],
			defaultMode: "table",
			formatKind: "csv",
		});
		expect(getFilePanelDisplayOptions("/repo/users.tsv")).toEqual({
			availableModes: ["table", "raw"],
			defaultMode: "table",
			formatKind: "tsv",
		});
	});

	it("uses rendered-only mode for pdf and image files", () => {
		expect(getFilePanelDisplayOptions("/repo/document.pdf")).toEqual({
			availableModes: ["rendered"],
			defaultMode: "rendered",
			formatKind: "pdf",
		});
		expect(getFilePanelDisplayOptions("/repo/photo.png")).toEqual({
			availableModes: ["rendered"],
			defaultMode: "rendered",
			formatKind: "image",
		});
	});

	it("uses raw mode only for unsupported formats", () => {
		expect(getFilePanelDisplayOptions("/repo/main.ts")).toEqual({
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
