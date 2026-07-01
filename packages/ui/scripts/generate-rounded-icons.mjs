import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const sourceDir = process.argv[2] ?? process.env.CODEX_ICONS_DIR;
const outputFile = resolve(
	process.cwd(),
	"src/components/icons/rounded-icon-data.generated.ts",
);

if (!sourceDir) {
	throw new Error(
		"Pass the rounded icon source package path, for example: bun scripts/generate-rounded-icons.mjs /path/to/rounded-icon-source",
	);
}

const resolvedSourceDir = resolve(sourceDir);
const svgDir = join(resolvedSourceDir, "svg");
const manifestPath = join(resolvedSourceDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const customEntries = {
	"new-chat": {
		viewBox: "0 0 16 16",
		inner: '<g fill="currentColor"><path d="M6.33325 1.88379C6.58178 1.88379 6.78345 2.08546 6.78345 2.33398C6.78328 2.58237 6.58168 2.78418 6.33325 2.78418H4.66626C3.62638 2.78435 2.78362 3.62711 2.78345 4.66699V11.334C2.78361 12.3739 3.62637 13.2176 4.66626 13.2178H11.3333C12.3733 13.2178 13.2169 12.374 13.217 11.334V9.66699C13.2172 9.41872 13.418 9.21795 13.6663 9.21777C13.9147 9.21777 14.1163 9.41861 14.1165 9.66699V11.334C14.1163 12.871 12.8703 14.1172 11.3333 14.1172H4.66626C3.12932 14.117 1.88322 12.8709 1.88306 11.334V4.66699C1.88323 3.13006 3.12933 1.88396 4.66626 1.88379H6.33325Z"/><path d="M10.8948 2.375C11.6494 1.63227 12.8628 1.63698 13.6116 2.38574C14.362 3.13643 14.3637 4.35266 13.6165 5.10644L9.36353 9.39355C9.01402 9.74579 8.56977 9.98985 8.08521 10.0967L6.17603 10.5166C5.74813 10.6107 5.36686 10.2296 5.46118 9.80176L5.88208 7.89746C5.98978 7.4105 6.23578 6.96428 6.59106 6.61426L10.8948 2.375ZM12.9749 3.02148C12.5756 2.62258 11.9289 2.62086 11.5266 3.0166L7.2229 7.25586C6.99148 7.4839 6.83116 7.77457 6.76099 8.0918L6.44165 9.53711L7.89185 9.21777C8.20744 9.14811 8.49721 8.98919 8.72485 8.75976L12.9778 4.47266C13.3759 4.07066 13.375 3.42164 12.9749 3.02148Z"/></g>',
	},
	search: {
		viewBox: "0 0 16 16",
		inner: '<g fill="currentColor"><path d="M7.33057 1.98535C10.2484 1.98535 12.6136 4.3508 12.6138 7.26855C12.6138 8.58031 12.1346 9.77942 11.3433 10.7031L13.9897 13.3496C14.1655 13.5253 14.1655 13.8106 13.9897 13.9863C13.814 14.1621 13.5288 14.1621 13.353 13.9863L10.7017 11.335C9.78678 12.0942 8.61243 12.5518 7.33057 12.5518C4.41281 12.5516 2.04736 10.1864 2.04736 7.26855C2.04754 4.35091 4.41292 1.98553 7.33057 1.98535ZM7.33057 2.88574C4.90998 2.88592 2.94793 4.84796 2.94775 7.26855C2.94775 9.68929 4.90987 11.6522 7.33057 11.6523C9.75141 11.6523 11.7144 9.6894 11.7144 7.26855C11.7142 4.84786 9.75131 2.88574 7.33057 2.88574Z"/></g>',
	},
	"chevron-right": {
		viewBox: "0 0 16 16",
		inner: '<g fill="currentColor"><path d="M10.999 8.352L5.534 13.818C5.41551 13.9303 5.25786 13.9918 5.09466 13.9895C4.93146 13.9872 4.77561 13.9212 4.66033 13.8057C4.54505 13.6902 4.47945 13.5342 4.47752 13.3709C4.47559 13.2077 4.53748 13.0502 4.65 12.932L9.585 7.998L4.651 3.067C4.53862 2.94864 4.47691 2.79106 4.47903 2.62786C4.48114 2.46466 4.54692 2.30874 4.66233 2.19333C4.77774 2.07792 4.93366 2.01215 5.09686 2.01003C5.26006 2.00792 5.41763 2.06962 5.536 2.182L11 7.647L10.999 8.352Z"/></g>',
	},
	"chevron-left": {
		viewBox: "0 0 16 16",
		inner: '<g transform="rotate(180 8 8)" fill="currentColor"><path d="M10.999 8.352L5.534 13.818C5.41551 13.9303 5.25786 13.9918 5.09466 13.9895C4.93146 13.9872 4.77561 13.9212 4.66033 13.8057C4.54505 13.6902 4.47945 13.5342 4.47752 13.3709C4.47559 13.2077 4.53748 13.0502 4.65 12.932L9.585 7.998L4.651 3.067C4.53862 2.94864 4.47691 2.79106 4.47903 2.62786C4.48114 2.46466 4.54692 2.30874 4.66233 2.19333C4.77774 2.07792 4.93366 2.01215 5.09686 2.01003C5.26006 2.00792 5.41763 2.06962 5.536 2.182L11 7.647L10.999 8.352Z"/></g>',
	},
	"chevron-down": {
		viewBox: "0 0 16 16",
		inner: '<g fill="currentColor"><path d="M8.35176 10.9989L13.8178 5.53391C13.876 5.47594 13.9222 5.40702 13.9537 5.33113C13.9851 5.25524 14.0013 5.17387 14.0012 5.0917C14.0011 5.00954 13.9848 4.9282 13.9531 4.85238C13.9215 4.77656 13.8751 4.70775 13.8168 4.64991C13.6991 4.53309 13.5401 4.46753 13.3743 4.46753C13.2085 4.46753 13.0494 4.53309 12.9318 4.64991L7.99776 9.58491L3.06776 4.65091C2.9494 4.53853 2.79183 4.47682 2.62863 4.47894C2.46542 4.48106 2.3095 4.54683 2.19409 4.66224C2.07868 4.77765 2.01291 4.93357 2.01079 5.09677C2.00868 5.25997 2.07039 5.41754 2.18276 5.53591L7.64776 10.9999L8.35176 10.9989Z"/></g>',
	},
	"chevron-up": {
		viewBox: "0 0 16 16",
		inner: '<g fill="currentColor"><path d="M8.35179 5.001L13.8178 10.466C13.876 10.524 13.9222 10.5929 13.9537 10.6688C13.9852 10.7447 14.0013 10.826 14.0012 10.9082C14.0011 10.9904 13.9848 11.0717 13.9531 11.1475C13.9215 11.2234 13.8751 11.2922 13.8168 11.35C13.6991 11.4668 13.5401 11.5324 13.3743 11.5324C13.2085 11.5324 13.0494 11.4668 12.9318 11.35L7.99879 6.416L3.06679 11.349C2.94842 11.4614 2.79085 11.5231 2.62765 11.521C2.46445 11.5189 2.30853 11.4531 2.19312 11.3377C2.07771 11.2223 2.01193 11.0663 2.00982 10.9031C2.0077 10.7399 2.06941 10.5824 2.18179 10.464L7.64779 5L8.35179 5.001Z"/></g>',
	},
	refresh: {
		viewBox: "0 0 16 16",
		inner: '<g fill="currentColor"><path d="M12.5895 4.83613L11.23 6.19601C10.933 6.49201 11.143 7.00001 11.563 7.00001H15.138C15.398 7.00001 15.609 6.78901 15.609 6.52901V2.95401C15.609 2.53401 15.101 2.32401 14.804 2.62101L13.672 3.75328C12.3204 1.78973 10.0599 0.5 7.5 0.5C3.364 0.5 0 3.864 0 8C0 12.136 3.364 15.5 7.5 15.5C11.296 15.5 14.434 12.663 14.925 9H13.41C12.932 11.833 10.468 14 7.5 14C4.191 14 1.5 11.309 1.5 8C1.5 4.691 4.191 2 7.5 2C9.64738 2 11.5311 3.13503 12.5895 4.83613Z"/></g>',
	},
	hand: {
		viewBox: "0 0 20 20",
		inner: '<path d="M7.2 9.7V5.6a1.1 1.1 0 0 1 2.2 0v3.2M9.4 8.7V4.8a1.1 1.1 0 0 1 2.2 0v4M11.6 9V6a1.1 1.1 0 0 1 2.2 0v5.2c0 3.1-1.7 5.2-4.7 5.2H8c-1.4 0-2.4-.5-3.2-1.5L2.9 12a1.1 1.1 0 0 1 1.8-1.3l1.1 1.4V8.4a1.1 1.1 0 0 1 2.2 0v1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	download: {
		viewBox: "0 0 24 24",
		inner: '<g fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M16.969 10.059C17.262 9.766 17.737 9.766 18.03 10.059C18.323 10.352 18.323 10.827 18.03 11.12L12.15 17H11.35L5.46896 11.12C5.17596 10.827 5.17596 10.352 5.46896 10.059C5.76196 9.766 6.23696 9.766 6.52996 10.059L11 14.529V2.75C11 2.336 11.336 2 11.75 2C12.164 2 12.5 2.336 12.499 2.75V14.529L16.969 10.059ZM4.98193 19.7L5.78193 20.5H17.7169L18.5169 19.7V17.75C18.5169 17.336 18.8529 17 19.2669 17C19.6809 17 20.0169 17.336 20.0169 17.75V19.5C20.0169 20.881 18.8979 22 17.5169 22H5.98193C4.60093 22 3.48193 20.881 3.48193 19.5V17.75C3.48193 17.336 3.81793 17 4.23193 17C4.64593 17 4.98193 17.336 4.98193 17.75V19.7Z"/></g>',
	},
};

const preferredAliases = {
	"app-window": "app-window-b6aaamvg",
	bell: "automations-page-5wt3epnk",
	brain: "reasoning-minimal-lzpeywud--08",
	sidebar: "app-shell-bnrwydfu--03",
	plus: "plus-d3dp-dmx",
	"chart-line": "pricing-plan-page-bojp7gtn--31",
	settings: "settings-cog-mjpuk5w",
	"shield-code": "shield-code-bqug9ybu",
	"shield-check": "hooks-settings-dasiwpyv",
	"shield-warning": "shield-exclamation-kf9myntx",
	files: "folders-dyfgzyqz",
	folder: "folder-bpwd3kcz",
	plan: "plan-dhny1pkx",
	review: "review-header-toolbar-adr062sp--01",
	browser: "globe-oc2o98t5",
	terminal: "terminal-bhtf7d-4",
	filter: "app-main-b9iamgew--08",
	sliders: "use-is-dictation-supported-cfnkis4k--04",
	code: "code-dj-8g3vy",
	more: "three-dots-c-3fbqw8",
	microphone: "use-is-dictation-supported-cfnkis4k--06",
	moon: "gpu-tearing-debug-settings-b8w-l8wh",
	"paper-plane": "thread-side-panel-tabs-qmoazjz--02",
	link: "link-disddasq",
	"external-link": "link-external-oqlwmwwx",
	eye: "review-header-toolbar-adr062sp--02",
	"file-text": "get-file-icon-emolzufn--07",
	"git-diff": "diff-unified-bj8g3qql--01",
	copy: "copy-d11cb-0i",
	trash: "trash-clrlrkdw",
	check: "check-lg-dcpbggas",
	minus: "minus-dprbejgq",
	close: "x-dypucsqe",
	"x-circle": "x-circle-cfq7iwx",
	"x-circle-filled": "x-circle-filled-dpbzvfj3",
	"arrow-counter-clockwise": "arrow-rotate-ccw-b3tr4czg",
	"arrow-left": "arrow-left-cy8p3y0c",
	"arrow-right": "app-main-b9iamgew--01",
	"arrow-up": "arrow-up-coa6jjxn",
	"arrow-top-right": "arrow-top-right-c3w7bbw4",
	"arrow-up-right": "arrow-up-right-lg-brqfkomv",
	expand: "expand-ciw-vcu3--01",
	collapse: "expand-ciw-vcu3--02",
	play: "play-sm-bgmgx9gj",
	"play-outline": "play-outline-sajgrat4",
	"check-circle": "check-circle-b-kjslxa",
	"check-circle-filled": "check-circle-filled-bp7jivp",
	"circle-dashed": "pull-request-status-bdnvgysd--01",
	"question-circle": "question-mark-circle-bun0omof",
	"pull-request": "pull-request-open-dat8z13d",
	"pull-request-closed": "pull-request-status-bdnvgysd--03",
	"pull-request-merged": "pull-request-status-bdnvgysd--06",
	sparkle: "profile-dropdown-d8zfwx8a--02",
	"google-drive": "google-drive-cc-egn92",
};

const blockedAliases = new Set([
	// The source icon is Google Drive, not the general Google sign-in mark.
	"google",
]);

function readAttribute(attributes, name) {
	const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
	return match ? match[1] : "";
}

function withoutOuterSvgAttributes(attributes) {
	return attributes
		.replace(/\s+xmlns="[^"]*"/g, "")
		.replace(/\s+viewBox="[^"]*"/g, "")
		.replace(/\s+width="[^"]*"/g, "")
		.replace(/\s+height="[^"]*"/g, "")
		.replace(/\s+id="[^"]*"/g, "")
		.trim();
}

function svgInner(svg) {
	return svg.replace(/^<svg\b[^>]*>/s, "").replace(/<\/svg>\s*$/s, "").trim();
}

function wrapInner(attributes, inner) {
	let safeAttributes = withoutOuterSvgAttributes(attributes);
	if (/\bstroke-width=/.test(safeAttributes) && !/\bstroke=/.test(safeAttributes)) {
		safeAttributes = `stroke="currentColor" ${safeAttributes}`;
	}

	return safeAttributes ? `<g ${safeAttributes}>${inner}</g>` : inner;
}

function readSvgEntry(fileName) {
	const iconName = basename(fileName, ".svg");
	const svg = readFileSync(join(svgDir, fileName), "utf8").trim();
	const match = svg.match(/^<svg\b([^>]*)>/s);
	if (!match) {
		throw new Error(`Missing <svg> wrapper in ${fileName}`);
	}

	const viewBox = readAttribute(match[1], "viewBox");
	if (viewBox) {
		return [
			{
				name: iconName,
				viewBox,
				inner: wrapInner(match[1], svgInner(svg)),
			},
		];
	}

	return readSymbolEntries(iconName, svg);
}

function readSymbolEntries(iconName, svg) {
	const entries = [];
	const symbolPattern = /<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g;
	let symbolMatch = symbolPattern.exec(svg);
	while (symbolMatch) {
		const symbolId = readAttribute(symbolMatch[1], "id").replace(/^icon-/, "");
		const viewBox = readAttribute(symbolMatch[1], "viewBox");
		if (symbolId && viewBox) {
			entries.push({
				name: `${iconName}-${symbolId}`,
				viewBox,
				inner: wrapInner(symbolMatch[1], symbolMatch[2].trim()),
			});
		}
		symbolMatch = symbolPattern.exec(svg);
	}

	if (entries.length === 0) {
		throw new Error(`Missing viewBox and symbols in ${iconName}`);
	}

	return entries;
}

function quoted(value) {
	return JSON.stringify(value);
}

const entries = [];
const sourceFiles = readdirSync(svgDir)
	.filter((fileName) => fileName.endsWith(".svg"))
	.sort();

for (const fileName of sourceFiles) {
	entries.push(...readSvgEntry(fileName));
}

for (const [name, entry] of Object.entries(customEntries)) {
	entries.push({
		name,
		viewBox: entry.viewBox,
		inner: entry.inner,
	});
}

entries.sort((first, second) => first.name.localeCompare(second.name));

const canonicalNames = entries.map((entry) => entry.name);
const canonicalNameSet = new Set(canonicalNames);
const customNameSet = new Set(Object.keys(customEntries));

const iconNameCounts = new Map();
for (const icon of manifest.icons) {
	iconNameCounts.set(icon.iconName, (iconNameCounts.get(icon.iconName) ?? 0) + 1);
}

const aliases = {};
for (const icon of manifest.icons) {
	const alias = icon.iconName;
	const target = basename(icon.fileName, ".svg");
	if (
		iconNameCounts.get(alias) === 1 &&
		canonicalNameSet.has(target) &&
		!customNameSet.has(alias) &&
		!blockedAliases.has(alias)
	) {
		aliases[alias] = target;
	}
}

for (const [alias, target] of Object.entries(preferredAliases)) {
	if (!canonicalNameSet.has(target)) {
		throw new Error(`Alias ${alias} points to missing icon ${target}`);
	}
	aliases[alias] = target;
}

const aliasNames = Object.keys(aliases).sort();
const iconNameLines = canonicalNames.map((name) => `\t${quoted(name)},`);
const aliasNameLines = aliasNames.map((name) => `\t${quoted(name)},`);
const iconDataLines = entries.map(
	(entry) =>
		`\t${quoted(entry.name)}: { viewBox: ${quoted(entry.viewBox)}, inner: ${quoted(entry.inner)} },`,
);
const aliasLines = aliasNames.map((name) => `\t${quoted(name)}: ${quoted(aliases[name])},`);

const output = `// Generated by packages/ui/scripts/generate-rounded-icons.mjs.
// Source: rounded icon package (${sourceFiles.length} SVG files).

export type RoundedIconData = {
\treadonly viewBox: string;
\treadonly inner: string;
};

export const roundedIconNames = [
${iconNameLines.join("\n")}
] as const;

export type RoundedIconCanonicalName = (typeof roundedIconNames)[number];

export const roundedIconData: Record<RoundedIconCanonicalName, RoundedIconData> = {
${iconDataLines.join("\n")}
};

export const roundedIconAliasNames = [
${aliasNameLines.join("\n")}
] as const;

export type RoundedIconAliasName = (typeof roundedIconAliasNames)[number];

export const roundedIconAliases: Record<RoundedIconAliasName, RoundedIconCanonicalName> = {
${aliasLines.join("\n")}
};

export type RoundedIconName = RoundedIconCanonicalName | RoundedIconAliasName;

export function isRoundedIconAliasName(name: RoundedIconName): name is RoundedIconAliasName {
\treturn Object.prototype.hasOwnProperty.call(roundedIconAliases, name);
}

export function resolveRoundedIconName(name: RoundedIconName): RoundedIconCanonicalName {
\tif (isRoundedIconAliasName(name)) {
\t\treturn roundedIconAliases[name];
\t}

\treturn name;
}
`;

writeFileSync(outputFile, output);

console.log(
	`Generated ${entries.length} rounded icons and ${aliasNames.length} aliases at ${outputFile}`,
);
