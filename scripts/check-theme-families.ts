/**
 * Every theme family a picker can show must have a stylesheet behind it.
 *
 * themes.ts is what UI lists; theme.css is what the browser paints. If the two
 * drift, a user picks a theme and the app renders nothing. happy-dom does not
 * resolve custom properties from stylesheets, so this cannot be a unit test;
 * it lives here with the repo's other invariants instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI_SRC = join(import.meta.dir, "..", "packages", "ui", "src", "lib");
const css = readFileSync(join(UI_SRC, "theme.css"), "utf8");
const registry = readFileSync(join(UI_SRC, "themes.ts"), "utf8");

/** Tokens a family must set for the app to render at all. */
const REQUIRED_TOKENS = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"destructive-foreground",
	"success",
	"success-foreground",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"sidebar",
	"sidebar-foreground",
	"sidebar-border",
	"sidebar-ring",
	"build-icon",
	"plan-icon",
	"cursor-status-error",
	"cursor-status-warning",
	"cursor-status-success",
];

const familyIds = [...registry.matchAll(/^\t\tid: "([a-z0-9-]+)",$/gm)].map(
	(match) => match[1],
);

if (familyIds.length === 0) {
	console.error(
		"check-theme-families: found no families in themes.ts — did its shape change?",
	);
	process.exit(1);
}

function blockFor(id: string, appearance: "light" | "dark"): string | null {
	const selector =
		appearance === "dark"
			? `[data-ui-theme="${id}"].dark {`
			: `[data-ui-theme="${id}"] {`;
	const start = css.indexOf(selector);
	if (start === -1) return null;
	return css.slice(start, css.indexOf("}", start));
}

const problems: string[] = [];

for (const id of familyIds) {
	for (const appearance of ["light", "dark"] as const) {
		const block = blockFor(id, appearance);
		if (block === null) {
			problems.push(`${id} (${appearance}) has no block in theme.css`);
			continue;
		}
		const missing = REQUIRED_TOKENS.filter(
			(token) => !block.includes(`--${token}:`),
		);
		if (missing.length > 0) {
			problems.push(
				`${id} (${appearance}) is missing ${missing.map((t) => `--${t}`).join(", ")}`,
			);
		}
	}
}

if (problems.length > 0) {
	console.error("Theme families and theme.css disagree:");
	for (const problem of problems) console.error(`- ${problem}`);
	process.exit(1);
}

console.log(
	`Theme family check passed: ${familyIds.length} families, both appearances.`,
);
