#!/usr/bin/env bun
/**
 * The design-system page is only trustworthy while every token it advertises is
 * really declared. A renamed or deleted custom property must fail here, not
 * render as an empty swatch nobody notices.
 *
 * This is a check script rather than a test on purpose. Reading stylesheets to
 * assert on their contents is source inspection, which the repo's test guard
 * rejects, and vitest stubs CSS imports to an empty string so `?raw` cannot see
 * them either. The same invariant lives here alongside the repo's other
 * structural checks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { allDeclaredTokenNames } from "../src/lib/design-system/tokens.js";

const repoRoot = join(import.meta.dir, "..", "..", "..");

const stylesheets = [
	"packages/website/src/routes/layout.css",
	"packages/ui/src/lib/design-tokens.css",
	"packages/ui/src/lib/theme.css",
]
	.map((relative) => readFileSync(join(repoRoot, relative), "utf8"))
	.join("\n");

const missing = allDeclaredTokenNames().filter(
	(name) => !new RegExp(`--${name}\\s*:`).test(stylesheets)
);

if (missing.length > 0) {
	console.error(`check-design-tokens: ${String(missing.length)} advertised token(s) never declared:`);
	for (const name of missing) {
		console.error(`  --${name}`);
	}
	process.exit(1);
}

console.log(
	`check-design-tokens: ${String(allDeclaredTokenNames().length)} advertised tokens, all declared.`
);
