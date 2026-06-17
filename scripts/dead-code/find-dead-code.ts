import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { Result, err, ok } from "neverthrow";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonMap;
type JsonMap = { readonly [key: string]: JsonValue };

type RootKind =
	| "package-manifest"
	| "package-export"
	| "package-script"
	| "sveltekit-route"
	| "config"
	| "tauri-config"
	| "tauri-capability"
	| "rust-root"
	| "test"
	| "type-declaration"
	| "static-asset"
	| "allowlist";

type CandidateClassification =
	| "production-reachable"
	| "export-barrel-only"
	| "script-only"
	| "test-only"
	| "static-root"
	| "generated-vendor"
	| "already-deleted"
	| "strong-dead"
	| "ignored";

const CANDIDATE_CLASSIFICATIONS = new Set<CandidateClassification>([
	"production-reachable",
	"export-barrel-only",
	"script-only",
	"test-only",
	"static-root",
	"generated-vendor",
	"already-deleted",
	"strong-dead",
	"ignored",
]);

type FileKind = "source" | "asset" | "config" | "manifest" | "doc" | "other";

interface AllowlistEntry {
	readonly path: string;
	readonly classification: CandidateClassification;
	readonly reason: string;
}

interface LoadedAllowlist {
	readonly entries: readonly AllowlistEntry[];
}

interface PackageInfo {
	readonly dir: string;
	readonly manifestPath: string;
	readonly name: string | null;
	readonly json: JsonMap;
}

interface GraphEdge {
	readonly from: string;
	readonly to: string;
	readonly reason: string;
}

interface RootReason {
	readonly path: string;
	readonly kind: RootKind;
	readonly reason: string;
}

interface Candidate {
	readonly path: string;
	readonly classification: CandidateClassification;
	readonly fileKind: FileKind;
	readonly reasons: readonly string[];
}

interface UnresolvedReference {
	readonly from: string;
	readonly specifier: string;
	readonly reason: string;
}

interface AnalysisOptions {
	readonly repoRoot: string;
	readonly allowlistPath?: string;
	readonly includeGitStatus: boolean;
}

export interface DeadCodeAnalysis {
	readonly repoRoot: string;
	readonly files: readonly string[];
	readonly roots: readonly RootReason[];
	readonly edges: readonly GraphEdge[];
	readonly unresolved: readonly UnresolvedReference[];
	readonly candidates: readonly Candidate[];
	readonly alreadyDeleted: readonly Candidate[];
	readonly counts: Readonly<Record<CandidateClassification, number>>;
}

const SKIP_DIR_NAMES = new Set([
	".git",
	".codex",
	".svelte-kit",
	"node_modules",
	"dist",
	"build",
	"target",
	".turbo",
	"coverage",
]);

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".svelte",
	".rs",
	".css",
]);

const ASSET_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".svg",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".mp3",
	".wav",
	".pdf",
]);

const CONFIG_BASENAMES = new Set([
	"vite.config.ts",
	"vite.config.js",
	"svelte.config.js",
	"svelte.config.ts",
	"tsconfig.json",
	"tsconfig.fast.json",
	"tsconfig.svelte-check.json",
	"biome.json",
	"postcss.config.js",
	"tailwind.config.ts",
	"tailwind.config.js",
	"drizzle.config.ts",
	"drizzle.config.js",
	"bunfig.toml",
]);

const MODULE_RESOLUTION_EXTENSIONS = [
	"",
	".ts",
	".tsx",
	".svelte",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".css",
];

const INDEX_RESOLUTION_FILES = [
	"index.ts",
	"index.tsx",
	"index.svelte",
	"index.js",
	"index.mjs",
	"index.css",
];

const parseJsonValue = Result.fromThrowable(
	(source: string): JsonValue => JSON.parse(source) as JsonValue,
	(error) => (error instanceof Error ? error.message : String(error))
);

function isJsonMap(value: JsonValue): value is JsonMap {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string | null {
	return typeof value === "string" ? value : null;
}

function isCandidateClassification(value: string): value is CandidateClassification {
	return CANDIDATE_CLASSIFICATIONS.has(value as CandidateClassification);
}

function normalizeRepoPath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function toRepoPath(repoRoot: string, path: string): string {
	const absolutePath = isAbsolute(path) ? path : resolve(repoRoot, path);
	return normalizeRepoPath(relative(repoRoot, absolutePath));
}

function toAbsolutePath(repoRoot: string, repoPath: string): string {
	return resolve(repoRoot, repoPath);
}

function readJsonMap(path: string): Result<JsonMap, string> {
	const parsed = parseJsonValue(readFileSync(path, "utf8"));
	return parsed.andThen((value) => {
		if (!isJsonMap(value)) {
			return err(`${path} must contain a JSON object`);
		}
		return ok(value);
	});
}

function collectFiles(repoRoot: string, currentPath: string, results: string[]): void {
	for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIR_NAMES.has(entry.name)) {
				continue;
			}
			collectFiles(repoRoot, join(currentPath, entry.name), results);
			continue;
		}

		if (entry.isFile()) {
			results.push(toRepoPath(repoRoot, join(currentPath, entry.name)));
		}
	}
}

function classifyFileKind(path: string): FileKind {
	const name = basename(path);
	const extension = extname(path);
	if (name === "package.json" || name === "Cargo.toml") {
		return "manifest";
	}
	if (CONFIG_BASENAMES.has(name) || extension === ".json" || extension === ".toml") {
		return "config";
	}
	if (SOURCE_EXTENSIONS.has(extension)) {
		return "source";
	}
	if (ASSET_EXTENSIONS.has(extension)) {
		return "asset";
	}
	if (extension === ".md" || extension === ".mdx") {
		return "doc";
	}
	return "other";
}

function isTestPath(path: string): boolean {
	return /(?:\.test|\.spec|\.vitest)\.(?:ts|tsx|js|jsx|rs)$/.test(path) ||
		path.includes("/__tests__/") ||
		path.includes("/tests/");
}

function isSvelteKitRoute(path: string): boolean {
	const name = basename(path);
	return path.includes("/src/routes/") && name.startsWith("+");
}

function isSvelteKitConventionRoot(path: string): boolean {
	const name = basename(path);
	return path.includes("/src/") &&
		(name === "hooks.ts" ||
			name === "hooks.server.ts" ||
			name === "app.d.ts" ||
			name === "app.html" ||
			name.startsWith("service-worker."));
}

function isStaticAsset(path: string): boolean {
	return path.includes("/static/") || path.includes("/public/");
}

function isManualScript(path: string): boolean {
	return path.startsWith("scripts/") ||
		path.includes("/scripts/") ||
		path.startsWith(".github/skills/");
}

function isGeneratedOrVendor(path: string): boolean {
	return path.includes("/src-tauri/gen/") ||
		path.includes("/src-tauri/cc-sdk-local/") ||
		path.includes("/src-tauri/vendor/") ||
		path.includes("/node_modules/") ||
		path.includes("/target/");
}

function readAllowlist(repoRoot: string, allowlistPath: string | undefined): Result<LoadedAllowlist, string> {
	const resolvedPath = allowlistPath ?? "scripts/dead-code/dead-code-allowlist.json";
	const absolutePath = toAbsolutePath(repoRoot, resolvedPath);
	if (!existsSync(absolutePath)) {
		return ok({ entries: [] });
	}

	return readJsonMap(absolutePath).andThen((json) => {
		const version = json.version;
		const entries = json.entries;
		if (version !== 1) {
			return err(`${resolvedPath} must declare version 1`);
		}
		if (!Array.isArray(entries)) {
			return err(`${resolvedPath} must contain an entries array`);
		}

		const allowlistEntries: AllowlistEntry[] = [];
		for (const entry of entries) {
			if (!isJsonMap(entry)) {
				return err(`${resolvedPath} contains a non-object entry`);
			}
			const path = asString(entry.path);
			const classification = asString(entry.classification);
			const reason = asString(entry.reason);
			if (path === null || classification === null || reason === null) {
				return err(`${resolvedPath} entries require path, classification, and reason`);
			}
			if (!isCandidateClassification(classification)) {
				return err(`${resolvedPath} entry for ${path} has invalid classification ${classification}`);
			}
			allowlistEntries.push({
				path,
				classification,
				reason,
			});
		}
		return ok({ entries: allowlistEntries });
	});
}

function allowlistMatch(path: string, entries: readonly AllowlistEntry[]): AllowlistEntry | null {
	for (const entry of entries) {
		if (entry.path.endsWith("/**")) {
			const prefix = entry.path.slice(0, -3);
			if (path === prefix || path.startsWith(`${prefix}/`)) {
				return entry;
			}
			continue;
		}
		if (entry.path === path) {
			return entry;
		}
	}
	return null;
}

function collectPackages(repoRoot: string, files: readonly string[]): PackageInfo[] {
	const packages: PackageInfo[] = [];
	for (const file of files) {
		if (basename(file) !== "package.json") {
			continue;
		}
		const absolutePath = toAbsolutePath(repoRoot, file);
		const jsonResult = readJsonMap(absolutePath);
		if (jsonResult.isErr()) {
			continue;
		}
		const json = jsonResult.value;
		packages.push({
			dir: dirname(file),
			manifestPath: file,
			name: asString(json.name),
			json,
		});
	}
	return packages;
}

function addRoot(roots: RootReason[], path: string, kind: RootKind, reason: string): void {
	roots.push({
		path,
		kind,
		reason,
	});
}

function collectExportTargets(value: JsonValue | undefined, targets: string[]): void {
	if (value === undefined || value === null) {
		return;
	}
	if (typeof value === "string") {
		targets.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const child of value) {
			collectExportTargets(child, targets);
		}
		return;
	}
	if (isJsonMap(value)) {
		for (const child of Object.values(value)) {
			collectExportTargets(child, targets);
		}
	}
}

function resolveExistingPath(repoRoot: string, baseDir: string, specifier: string): string | null {
	const basePath = resolve(repoRoot, baseDir, specifier);
	const extension = extname(basePath);
	if (extension === ".js" || extension === ".jsx" || extension === ".mjs") {
		const withoutExtension = basePath.slice(0, -extension.length);
		const sourceCandidates = [
			`${withoutExtension}.ts`,
			`${withoutExtension}.tsx`,
			`${withoutExtension}.svelte`,
			basePath,
		];
		for (const candidate of sourceCandidates) {
			if (existsSync(candidate) && statSync(candidate).isFile()) {
				return toRepoPath(repoRoot, candidate);
			}
		}
	}

	for (const candidateExtension of MODULE_RESOLUTION_EXTENSIONS) {
		const candidate = `${basePath}${candidateExtension}`;
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return toRepoPath(repoRoot, candidate);
		}
	}

	if (existsSync(basePath) && statSync(basePath).isDirectory()) {
		for (const indexFile of INDEX_RESOLUTION_FILES) {
			const candidate = join(basePath, indexFile);
			if (existsSync(candidate) && statSync(candidate).isFile()) {
				return toRepoPath(repoRoot, candidate);
			}
		}
	}

	return null;
}

function collectScriptPathRoots(repoRoot: string, packageInfo: PackageInfo, roots: RootReason[]): void {
	const scripts = packageInfo.json.scripts;
	if (!isJsonMap(scripts)) {
		return;
	}
	const pathPattern = /(?:^|\s)(\.{0,2}\/?[\w@./-]+\.(?:ts|js|mjs|cjs|sh|rs))(?:\s|$)/g;
	for (const [scriptName, scriptValue] of Object.entries(scripts)) {
		if (typeof scriptValue !== "string") {
			continue;
		}
		let match = pathPattern.exec(scriptValue);
		while (match !== null) {
			const scriptPath = match[1];
			if (scriptPath !== undefined) {
				const resolved = resolveExistingPath(repoRoot, packageInfo.dir, scriptPath);
				if (resolved !== null) {
					addRoot(roots, resolved, "package-script", `${packageInfo.manifestPath} script ${scriptName}`);
				}
			}
			match = pathPattern.exec(scriptValue);
		}
	}
}

function collectPackageRoots(repoRoot: string, packages: readonly PackageInfo[], roots: RootReason[]): void {
	for (const packageInfo of packages) {
		addRoot(roots, packageInfo.manifestPath, "package-manifest", "workspace package manifest");

		const exportTargets: string[] = [];
		collectExportTargets(packageInfo.json.exports, exportTargets);
		for (const target of exportTargets) {
			const resolved = resolveExistingPath(repoRoot, packageInfo.dir, target);
			if (resolved !== null) {
				addRoot(roots, resolved, "package-export", `${packageInfo.manifestPath} export`);
			}
		}

		collectScriptPathRoots(repoRoot, packageInfo, roots);
	}
}

function collectConventionRoots(files: readonly string[], roots: RootReason[]): void {
	for (const file of files) {
		const name = basename(file);
		if (isManualScript(file) && SOURCE_EXTENSIONS.has(extname(file))) {
			addRoot(roots, file, "package-script", "manual repo script or skill script");
			continue;
		}
		if (isSvelteKitRoute(file)) {
			addRoot(roots, file, "sveltekit-route", "SvelteKit route convention");
			continue;
		}
		if (isSvelteKitConventionRoot(file)) {
			addRoot(roots, file, "sveltekit-route", "SvelteKit app convention root");
			continue;
		}
		if (CONFIG_BASENAMES.has(name)) {
			addRoot(roots, file, "config", "workspace config");
			continue;
		}
		if (file.endsWith("src-tauri/tauri.conf.json") || file.endsWith("src-tauri/tauri.staging.conf.json")) {
			addRoot(roots, file, "tauri-config", "Tauri config");
			continue;
		}
		if (file.includes("src-tauri/capabilities/") && file.endsWith(".json")) {
			addRoot(roots, file, "tauri-capability", "Tauri capability config");
			continue;
		}
		if (isTestPath(file)) {
			addRoot(roots, file, "test", "test root");
			continue;
		}
		if (file.endsWith(".d.ts")) {
			addRoot(roots, file, "type-declaration", "ambient TypeScript declaration");
			continue;
		}
		if (isStaticAsset(file)) {
			addRoot(roots, file, "static-asset", "static/public asset");
		}
	}
}

function collectCargoRoots(repoRoot: string, files: readonly string[], roots: RootReason[]): void {
	for (const file of files) {
		const name = basename(file);
		if (file.includes("/src/bin/") && file.endsWith(".rs")) {
			addRoot(roots, file, "rust-root", "Cargo automatic binary root");
			continue;
		}
		if (file.includes("/examples/") && file.endsWith(".rs")) {
			addRoot(roots, file, "rust-root", "Cargo example root");
			continue;
		}
		if (name === "lib.rs" || name === "main.rs" || name === "build.rs") {
			addRoot(roots, file, "rust-root", "Rust crate root");
		}
		if (name !== "Cargo.toml") {
			continue;
		}
		const content = readFileSync(toAbsolutePath(repoRoot, file), "utf8");
		const pathPattern = /^\s*path\s*=\s*"([^"]+)"/gm;
		let match = pathPattern.exec(content);
		while (match !== null) {
			const cargoPath = match[1];
			if (cargoPath !== undefined) {
				const resolved = resolveExistingPath(repoRoot, dirname(file), cargoPath);
				if (resolved !== null) {
					addRoot(roots, resolved, "rust-root", `${file} explicit path`);
				}
			}
			match = pathPattern.exec(content);
		}
	}
}

function stripBlockComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComments(source: string): string {
	return source
		.split("\n")
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
}

function sourceForImportScan(source: string, path: string): string {
	if (!path.endsWith(".svelte")) {
		return stripLineComments(stripBlockComments(source));
	}

	const blocks: string[] = [];
	const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
	let match = scriptPattern.exec(source);
	while (match !== null) {
		blocks.push(match[1] ?? "");
		match = scriptPattern.exec(source);
	}
	return stripLineComments(stripBlockComments(blocks.join("\n")));
}

function extractImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const importExportFromPattern =
		/^\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/gm;
	const sideEffectImportPattern = /^\s*import\s+["']([^"']+)["']/gm;

	let match = importExportFromPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
		match = importExportFromPattern.exec(source);
	}

	match = sideEffectImportPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
		match = sideEffectImportPattern.exec(source);
	}

	for (const specifier of extractDynamicImportSpecifiers(source)) {
		specifiers.push(specifier);
	}

	return specifiers;
}

function hasQuoteBeforeOnLine(source: string, index: number): boolean {
	const lineStart = source.lastIndexOf("\n", index - 1) + 1;
	const prefix = source.slice(lineStart, index);
	return prefix.includes("\"") || prefix.includes("'") || prefix.includes("`");
}

function extractDynamicImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
	let match = dynamicImportPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined && !hasQuoteBeforeOnLine(source, match.index)) {
			specifiers.push(specifier);
		}
		match = dynamicImportPattern.exec(source);
	}
	return specifiers;
}

function extractAssetSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const urlPattern = /\burl\(\s*["']?([^"')]+)["']?\s*\)/g;
	let match = urlPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined && !specifier.startsWith("data:") && !specifier.startsWith("http")) {
			specifiers.push(specifier);
		}
		match = urlPattern.exec(source);
	}
	return specifiers;
}

function packageNameFromSpecifier(specifier: string): string {
	if (specifier.startsWith("@")) {
		const segments = specifier.split("/");
		const scope = segments[0] ?? "";
		const name = segments[1] ?? "";
		return `${scope}/${name}`;
	}
	return specifier.split("/")[0] ?? specifier;
}

function packageSubpathFromSpecifier(packageName: string, specifier: string): string {
	if (specifier === packageName) {
		return ".";
	}
	return `.${specifier.slice(packageName.length)}`;
}

function nearestPackage(file: string, packages: readonly PackageInfo[]): PackageInfo | null {
	let best: PackageInfo | null = null;
	for (const packageInfo of packages) {
		if (file === packageInfo.manifestPath || file.startsWith(`${packageInfo.dir}/`)) {
			if (best === null || packageInfo.dir.length > best.dir.length) {
				best = packageInfo;
			}
		}
	}
	return best;
}

function resolvePackageExport(
	repoRoot: string,
	specifier: string,
	packagesByName: ReadonlyMap<string, PackageInfo>
): string | null {
	const packageName = packageNameFromSpecifier(specifier);
	const packageInfo = packagesByName.get(packageName);
	if (packageInfo === undefined) {
		return null;
	}
	const subpath = packageSubpathFromSpecifier(packageName, specifier);
	const exportsValue = packageInfo.json.exports;
	if (!isJsonMap(exportsValue)) {
		return resolveExistingPath(repoRoot, packageInfo.dir, subpath === "." ? "." : subpath);
	}
	const exportEntry = exportsValue[subpath];
	const targets: string[] = [];
	collectExportTargets(exportEntry, targets);
	for (const target of targets) {
		const resolved = resolveExistingPath(repoRoot, packageInfo.dir, target);
		if (resolved !== null) {
			return resolved;
		}
	}
	return null;
}

function resolveSpecifier(
	repoRoot: string,
	from: string,
	specifier: string,
	packages: readonly PackageInfo[],
	packagesByName: ReadonlyMap<string, PackageInfo>
): string | null {
	const cleanSpecifier = specifier.split("?")[0]?.split("#")[0] ?? specifier;
	if (cleanSpecifier.startsWith(".") || cleanSpecifier.startsWith("/")) {
		const baseDir = cleanSpecifier.startsWith("/") ? "" : dirname(from);
		return resolveExistingPath(repoRoot, baseDir, cleanSpecifier);
	}

	if (cleanSpecifier.startsWith("$lib/")) {
		const packageInfo = nearestPackage(from, packages);
		if (packageInfo !== null) {
			return resolveExistingPath(repoRoot, packageInfo.dir, `src/lib/${cleanSpecifier.slice(5)}`);
		}
	}

	if (cleanSpecifier.startsWith("$app") || cleanSpecifier.startsWith("$env")) {
		return null;
	}

	return resolvePackageExport(repoRoot, cleanSpecifier, packagesByName);
}

function shouldIgnoreUnresolvedSpecifier(specifier: string): boolean {
	return specifier === "./$types" ||
		specifier.endsWith("/$types") ||
		specifier.startsWith("$app") ||
		specifier.startsWith("$env") ||
		specifier.startsWith("$lib/paraglide/") ||
		specifier.includes("/node_modules/");
}

function rustModuleBaseDir(file: string): string {
	const name = basename(file);
	if (name === "mod.rs" || name === "lib.rs" || name === "main.rs") {
		return dirname(file);
	}
	return join(dirname(file), name.slice(0, -extname(name).length));
}

function collectRustEdges(repoRoot: string, file: string, source: string, edges: GraphEdge[]): void {
	const pathAttributePattern =
		/#\[path\s*=\s*"([^"]+)"\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
	let pathMatch = pathAttributePattern.exec(source);
	const pathModules = new Set<string>();
	while (pathMatch !== null) {
		const modulePath = pathMatch[1];
		const moduleName = pathMatch[2];
		if (modulePath !== undefined && moduleName !== undefined) {
			pathModules.add(moduleName);
			const resolved = resolveExistingPath(repoRoot, dirname(file), modulePath);
			if (resolved !== null) {
				edges.push({ from: file, to: resolved, reason: `rust path mod ${moduleName}` });
			}
		}
		pathMatch = pathAttributePattern.exec(source);
	}

	const modPattern = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
	let match = modPattern.exec(source);
	while (match !== null) {
		const moduleName = match[1];
		if (moduleName !== undefined && !pathModules.has(moduleName)) {
			const baseDir = rustModuleBaseDir(file);
			const first = resolveExistingPath(repoRoot, baseDir, `${moduleName}.rs`);
			const second = resolveExistingPath(repoRoot, baseDir, `${moduleName}/mod.rs`);
			const resolved = first ?? second;
			if (resolved !== null) {
				edges.push({ from: file, to: resolved, reason: `rust mod ${moduleName}` });
			}
		}
		match = modPattern.exec(source);
	}
}

function collectEdges(
	repoRoot: string,
	files: readonly string[],
	packages: readonly PackageInfo[],
	packagesByName: ReadonlyMap<string, PackageInfo>
): { readonly edges: readonly GraphEdge[]; readonly unresolved: readonly UnresolvedReference[] } {
	const edges: GraphEdge[] = [];
	const unresolved: UnresolvedReference[] = [];

	for (const file of files) {
		const kind = classifyFileKind(file);
		if (kind !== "source" && kind !== "config") {
			continue;
		}
		const absolutePath = toAbsolutePath(repoRoot, file);
		const source = readFileSync(absolutePath, "utf8");
		const importSource = sourceForImportScan(source, file);
		const dynamicSource = file.endsWith(".svelte")
			? stripLineComments(stripBlockComments(source))
			: "";
		const specifiers: string[] = [];
		for (const specifier of extractImportSpecifiers(importSource)) {
			specifiers.push(specifier);
		}
		for (const specifier of extractDynamicImportSpecifiers(dynamicSource)) {
			specifiers.push(specifier);
		}

		for (const specifier of specifiers) {
			const resolved = resolveSpecifier(repoRoot, file, specifier, packages, packagesByName);
			if (resolved !== null) {
				edges.push({ from: file, to: resolved, reason: `import ${specifier}` });
			} else if (
				!shouldIgnoreUnresolvedSpecifier(specifier) &&
				(specifier.startsWith(".") || specifier.startsWith("$lib/") || specifier.startsWith("@acepe/"))
			) {
				unresolved.push({ from: file, specifier, reason: "unresolved import" });
			}
		}

		for (const specifier of extractAssetSpecifiers(source)) {
			const resolved = resolveSpecifier(repoRoot, file, specifier, packages, packagesByName);
			if (resolved !== null) {
				edges.push({ from: file, to: resolved, reason: `asset ${specifier}` });
			}
		}

		if (file.endsWith(".toml") || file.endsWith(".json")) {
			for (const specifier of extractQuotedPathSpecifiers(source)) {
				const resolved = resolveSpecifier(repoRoot, file, specifier, packages, packagesByName);
				if (resolved !== null) {
					edges.push({ from: file, to: resolved, reason: `config path ${specifier}` });
				}
			}
		}

		if (file.endsWith(".rs")) {
			collectRustEdges(repoRoot, file, source, edges);
		}
	}

	return { edges, unresolved };
}

function extractQuotedPathSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const quotedPathPattern = /["'](\.{1,2}\/[^"']+\.(?:ts|js|mjs|cjs|sh|rs|json|toml))["']/g;
	let match = quotedPathPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
		match = quotedPathPattern.exec(source);
	}
	return specifiers;
}

export function parseGitPorcelain(output: string): Candidate[] {
	const candidates: Candidate[] = [];
	for (const line of output.split("\n")) {
		if (line.trim().length === 0) {
			continue;
		}
		const status = line.slice(0, 2);
		const rawPath = line.slice(3);
		if (status.includes("D") || status.includes("R")) {
			const path = rawPath.includes(" -> ") ? rawPath.split(" -> ")[0] ?? rawPath : rawPath;
			candidates.push({
				path: normalizeRepoPath(path.trim()),
				classification: "already-deleted",
				fileKind: classifyFileKind(path),
				reasons: [`git status ${status.trim()}`],
			});
		}
	}
	return candidates;
}

function isBarrelIndexPath(path: string): boolean {
	return /\/index\.(?:ts|tsx|js|mjs|cjs)$/.test(path);
}

function edgesWithoutBarrelReExports(edges: readonly GraphEdge[]): readonly GraphEdge[] {
	return edges.filter((edge) => !isBarrelIndexPath(edge.from));
}

function traverse(rootPaths: readonly string[], edges: readonly GraphEdge[]): Set<string> {
	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		const list = adjacency.get(edge.from) ?? [];
		list.push(edge.to);
		adjacency.set(edge.from, list);
	}

	const seen = new Set<string>();
	const queue: string[] = [];
	for (const rootPath of rootPaths) {
		queue.push(rootPath);
	}

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined || seen.has(current)) {
			continue;
		}
		seen.add(current);
		const children = adjacency.get(current) ?? [];
		for (const child of children) {
			if (!seen.has(child)) {
				queue.push(child);
			}
		}
	}

	return seen;
}

function buildCounts(candidates: readonly Candidate[]): Readonly<Record<CandidateClassification, number>> {
	const counts: Record<CandidateClassification, number> = {
		"production-reachable": 0,
		"export-barrel-only": 0,
		"script-only": 0,
		"test-only": 0,
		"static-root": 0,
		"generated-vendor": 0,
		"already-deleted": 0,
		"strong-dead": 0,
		ignored: 0,
	};
	for (const candidate of candidates) {
		counts[candidate.classification] = counts[candidate.classification] + 1;
	}
	return counts;
}

function rootPathsByKind(roots: readonly RootReason[], kinds: readonly RootKind[]): string[] {
	const kindSet = new Set(kinds);
	const paths: string[] = [];
	for (const root of roots) {
		if (kindSet.has(root.kind)) {
			paths.push(root.path);
		}
	}
	return paths;
}

function candidateReasons(path: string, roots: readonly RootReason[], edges: readonly GraphEdge[]): string[] {
	const reasons: string[] = [];
	for (const root of roots) {
		if (root.path === path) {
			reasons.push(`${root.kind}: ${root.reason}`);
		}
	}
	for (const edge of edges) {
		if (edge.to === path) {
			reasons.push(`${edge.from}: ${edge.reason}`);
		}
	}
	return reasons;
}

export function analyzeDeadCode(options: AnalysisOptions): Result<DeadCodeAnalysis, string> {
	const repoRoot = resolve(options.repoRoot);
	const files: string[] = [];
	collectFiles(repoRoot, repoRoot, files);
	files.sort();

	const allowlistResult = readAllowlist(repoRoot, options.allowlistPath);
	if (allowlistResult.isErr()) {
		return err(allowlistResult.error);
	}
	const allowlist = allowlistResult.value;
	const packages = collectPackages(repoRoot, files);
	const packagesByName = new Map<string, PackageInfo>();
	for (const packageInfo of packages) {
		if (packageInfo.name !== null) {
			packagesByName.set(packageInfo.name, packageInfo);
		}
	}

	const roots: RootReason[] = [];
	collectPackageRoots(repoRoot, packages, roots);
	collectConventionRoots(files, roots);
	collectCargoRoots(repoRoot, files, roots);
	for (const file of files) {
		const entry = allowlistMatch(file, allowlist.entries);
		if (entry !== null) {
			addRoot(roots, file, "allowlist", entry.reason);
		}
	}

	const collected = collectEdges(repoRoot, files, packages, packagesByName);
	const productionRoots = rootPathsByKind(roots, [
		"package-manifest",
		"package-export",
		"sveltekit-route",
		"config",
		"tauri-config",
		"tauri-capability",
		"rust-root",
		"type-declaration",
		"allowlist",
	]);
	const scriptRoots = rootPathsByKind(roots, ["package-script"]);
	const testRoots = rootPathsByKind(roots, ["test"]);
	const staticRoots = rootPathsByKind(roots, ["static-asset"]);

	const productionReachable = traverse(productionRoots, collected.edges);
	const directProductionReachable = traverse(
		productionRoots,
		edgesWithoutBarrelReExports(collected.edges)
	);
	const packageExportEntryReachable = traverse(
		rootPathsByKind(roots, ["package-export"]),
		collected.edges
	);
	const scriptReachable = traverse(scriptRoots, collected.edges);
	const testReachable = traverse(testRoots, collected.edges);
	const staticReachable = traverse(staticRoots, collected.edges);

	const candidates: Candidate[] = [];
	for (const file of files) {
		const kind = classifyFileKind(file);
		if (file.startsWith(".github/skills/")) {
			candidates.push({
				path: file,
				classification: "ignored",
				fileKind: kind,
				reasons: ["agent skill asset"],
			});
			continue;
		}
		if (kind === "doc" || kind === "other" || kind === "manifest" || kind === "config") {
			continue;
		}
		const allowlisted = allowlistMatch(file, allowlist.entries);
		const reasons = candidateReasons(file, roots, collected.edges);
		if (allowlisted !== null) {
			candidates.push({
				path: file,
				classification: allowlisted.classification,
				fileKind: kind,
				reasons: [allowlisted.reason],
			});
			continue;
		}
		if (isGeneratedOrVendor(file)) {
			candidates.push({
				path: file,
				classification: "generated-vendor",
				fileKind: kind,
				reasons: ["generated or vendored path"],
			});
			continue;
		}
		if (
			productionReachable.has(file) &&
			!directProductionReachable.has(file) &&
			!packageExportEntryReachable.has(file) &&
			!isBarrelIndexPath(file) &&
			kind === "source"
		) {
			candidates.push({
				path: file,
				classification: "export-barrel-only",
				fileKind: kind,
				reasons: [
					"reachable only through index/barrel re-exports, with no direct production import",
				],
			});
			continue;
		}
		if (productionReachable.has(file)) {
			candidates.push({
				path: file,
				classification: "production-reachable",
				fileKind: kind,
				reasons,
			});
			continue;
		}
		if (scriptReachable.has(file)) {
			candidates.push({
				path: file,
				classification: "script-only",
				fileKind: kind,
				reasons,
			});
			continue;
		}
		if (testReachable.has(file)) {
			candidates.push({
				path: file,
				classification: "test-only",
				fileKind: kind,
				reasons,
			});
			continue;
		}
		if (staticReachable.has(file) || isStaticAsset(file)) {
			candidates.push({
				path: file,
				classification: "static-root",
				fileKind: kind,
				reasons,
			});
			continue;
		}
		if (kind === "source") {
			candidates.push({
				path: file,
				classification: "strong-dead",
				fileKind: kind,
				reasons: ["not reachable from production, script, test, static, or allowlist roots"],
			});
		}
	}

	const alreadyDeleted = options.includeGitStatus
		? parseGitPorcelain(readGitStatus(repoRoot))
		: [];
	const allCandidates: Candidate[] = [];
	for (const candidate of candidates) {
		allCandidates.push(candidate);
	}
	for (const candidate of alreadyDeleted) {
		allCandidates.push(candidate);
	}

	return ok({
		repoRoot,
		files,
		roots,
		edges: collected.edges,
		unresolved: collected.unresolved,
		candidates,
		alreadyDeleted,
		counts: buildCounts(allCandidates),
	});
}

function readGitStatus(repoRoot: string): string {
	const proc = Bun.spawnSync({
		cmd: ["git", "status", "--porcelain"],
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		return "";
	}
	return new TextDecoder().decode(proc.stdout);
}

function candidatesByClassification(
	analysis: DeadCodeAnalysis,
	classification: CandidateClassification
): readonly Candidate[] {
	return analysis.candidates.filter((candidate) => candidate.classification === classification);
}

function formatCandidateList(candidates: readonly Candidate[], limit: number): string {
	if (candidates.length === 0) {
		return "- None\n";
	}
	const lines: string[] = [];
	for (const candidate of candidates.slice(0, limit)) {
		lines.push(`- \`${candidate.path}\` (${candidate.fileKind})`);
		for (const reason of candidate.reasons.slice(0, 3)) {
			lines.push(`  - ${reason}`);
		}
	}
	if (candidates.length > limit) {
		lines.push(`- ... ${candidates.length - limit} more`);
	}
	return `${lines.join("\n")}\n`;
}

export function formatMarkdownReport(analysis: DeadCodeAnalysis): string {
	const lines: string[] = [];
	lines.push("# Dead Code Report");
	lines.push("");
	lines.push("## Counts");
	lines.push("");
	for (const [classification, count] of Object.entries(analysis.counts)) {
		lines.push(`- ${classification}: ${count}`);
	}
	lines.push("");
	lines.push("## Strong Dead Candidates");
	lines.push("");
	lines.push(formatCandidateList(candidatesByClassification(analysis, "strong-dead"), 1000).trimEnd());
	lines.push("");
	lines.push("## Export-Barrel-Only Candidates");
	lines.push("");
	lines.push(
		formatCandidateList(candidatesByClassification(analysis, "export-barrel-only"), 100).trimEnd()
	);
	lines.push("");
	lines.push("## Test-Only Candidates");
	lines.push("");
	lines.push(formatCandidateList(candidatesByClassification(analysis, "test-only"), 100).trimEnd());
	lines.push("");
	lines.push("## Script-Only Candidates");
	lines.push("");
	lines.push(formatCandidateList(candidatesByClassification(analysis, "script-only"), 100).trimEnd());
	lines.push("");
	lines.push("## Already Deleted In Working Tree");
	lines.push("");
	lines.push(formatCandidateList(analysis.alreadyDeleted, 100).trimEnd());
	lines.push("");
	lines.push("## Unresolved Internal References");
	lines.push("");
	if (analysis.unresolved.length === 0) {
		lines.push("- None");
	} else {
		for (const unresolved of analysis.unresolved.slice(0, 200)) {
			lines.push(`- \`${unresolved.from}\` -> \`${unresolved.specifier}\`: ${unresolved.reason}`);
		}
		if (analysis.unresolved.length > 200) {
			lines.push(`- ... ${analysis.unresolved.length - 200} more`);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

interface CliOptions {
	readonly repoRoot: string;
	readonly outputPath: string | null;
	readonly format: "markdown" | "json";
	readonly strict: boolean;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
	let repoRoot = process.cwd();
	let outputPath: string | null = null;
	let format: "markdown" | "json" = "markdown";
	let strict = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--root") {
			repoRoot = argv[index + 1] ?? repoRoot;
			index += 1;
			continue;
		}
		if (arg === "--output") {
			outputPath = argv[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (arg === "--format") {
			const nextFormat = argv[index + 1];
			format = nextFormat === "json" ? "json" : "markdown";
			index += 1;
			continue;
		}
		if (arg === "--strict") {
			strict = true;
		}
	}

	return {
		repoRoot,
		outputPath,
		format,
		strict,
	};
}

function runCli(): void {
	const cli = parseCliOptions(process.argv.slice(2));
	const analysisResult = analyzeDeadCode({
		repoRoot: cli.repoRoot,
		includeGitStatus: true,
	});
	if (analysisResult.isErr()) {
		console.error(analysisResult.error);
		process.exit(1);
	}
	const analysis = analysisResult.value;
	const output = cli.format === "json"
		? `${JSON.stringify(analysis, null, 2)}\n`
		: formatMarkdownReport(analysis);

	if (cli.outputPath !== null) {
		const target = toAbsolutePath(cli.repoRoot, cli.outputPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, output);
	} else {
		process.stdout.write(output);
	}

	if (cli.strict && analysis.counts["strong-dead"] > 0) {
		process.exit(1);
	}
}

if (import.meta.main) {
	runCli();
}
