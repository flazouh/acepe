/**
 * Maps file extensions and filenames to icon names.
 * Used with a base path (e.g. /svgs/icons) to resolve full icon URLs.
 */
export const extensionToIcon: Record<string, string> = {
	// TypeScript
	ts: "typescript",
	tsx: "react_ts",
	mts: "typescript",
	cts: "typescript",
	"d.ts": "typescript-def",

	// JavaScript
	js: "javascript",
	jsx: "react",
	mjs: "javascript",
	cjs: "javascript",

	// Web frameworks
	svelte: "svelte",
	vue: "vue",
	astro: "astro",

	// Python
	py: "python",
	pyw: "python",
	pyc: "python",
	pyo: "python",
	pyi: "python",

	// Rust
	rs: "rust",
	ron: "rust",

	// Go
	go: "go",
	mod: "go-mod",

	// Java/JVM
	java: "java",
	class: "javaclass",
	jar: "java",
	jsp: "java",
	kotlin: "kotlin",
	kt: "kotlin",
	kts: "kotlin",
	scala: "scala",
	groovy: "groovy",
	gradle: "gradle",
	clj: "clojure",
	cljs: "clojure",

	// C/C++
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hxx: "cpp",

	// .NET
	cs: "csharp",
	fs: "fsharp",
	fsx: "fsharp",

	// Ruby
	rb: "ruby",
	erb: "ruby",
	rake: "ruby",
	gemfile: "ruby",

	// PHP
	php: "php",

	// Swift
	swift: "swift",

	// Functional languages
	hs: "haskell",
	lhs: "haskell",
	ml: "ocaml",
	mli: "ocaml",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	hrl: "erlang",

	// Other languages
	lua: "lua",
	luau: "luau",
	pl: "perl",
	pm: "perl",
	r: "r",
	R: "r",
	dart: "dart",
	zig: "zig",
	nim: "nim",
	jl: "julia",

	// Markup/Document
	html: "html",
	htm: "html",
	xhtml: "html",
	md: "markdown",
	markdown: "markdown",
	mdx: "markdown",
	tex: "tex",
	latex: "tex",

	// Styles
	css: "css",
	scss: "sass",
	sass: "sass",
	less: "less",
	styl: "stylus",

	// Data/Config
	json: "json",
	jsonc: "json",
	json5: "json",
	jsonl: "json",
	ndjson: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	xml: "xml",
	svg: "svg",
	csv: "table",
	parquet: "table",

	// Shell
	sh: "console",
	bash: "console",
	zsh: "console",
	fish: "console",
	ps1: "powershell",
	psm1: "powershell",
	psd1: "powershell",

	// Database
	sql: "database",
	sqlite: "database",
	prisma: "prisma",

	// Build/Config tools
	dockerfile: "docker",
	docker: "docker",
	makefile: "makefile",
	cmake: "cmake",

	// Package managers
	lock: "lock",

	// Version control
	gitignore: "git",
	gitattributes: "git",
	gitmodules: "git",

	// Config files
	env: "tune",
	ini: "settings",
	cfg: "settings",
	conf: "settings",
	config: "settings",
	editorconfig: "editorconfig",

	// Linters/Formatters
	eslintrc: "eslint",
	eslintignore: "eslint",
	prettierrc: "prettier",
	prettierignore: "prettier",

	// Build tools
	webpack: "webpack",
	vite: "vite",
	rollup: "rollup",

	// Testing
	test: "test-js",
	spec: "test-js",

	// Documentation
	txt: "document",
	rst: "document",
	pdf: "pdf",
	doc: "word",
	docx: "word",

	// Media
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	ico: "image",
	bmp: "image",
	mp4: "video",
	webm: "video",
	mov: "video",
	avi: "video",
	mkv: "video",
	mp3: "audio",
	wav: "audio",
	flac: "audio",
	ogg: "audio",

	// Fonts
	ttf: "font",
	otf: "font",
	woff: "font",
	woff2: "font",
	eot: "font",

	// Archives
	zip: "zip",
	tar: "zip",
	gz: "zip",
	rar: "zip",
	"7z": "zip",

	// GraphQL
	graphql: "graphql",
	gql: "graphql",

	// API
	proto: "proto",

	// Infrastructure
	tf: "terraform",
	tfvars: "terraform",
	hcl: "terraform",
	k8s: "kubernetes",

	// Certificates
	pem: "certificate",
	crt: "certificate",
	cer: "certificate",
	key: "key",
};

/**
 * Maps special filenames (case-insensitive) to icon names.
 */
export const filenameToIcon: Record<string, string> = {
	dockerfile: "docker",
	"docker-compose.yml": "docker",
	"docker-compose.yaml": "docker",
	makefile: "makefile",
	cmakelists: "cmake",
	"package.json": "npm",
	"package-lock.json": "npm",
	"pnpm-lock.yaml": "pnpm",
	"yarn.lock": "yarn",
	"bun.lockb": "bun",
	"cargo.toml": "rust",
	"cargo.lock": "rust",
	"go.mod": "go-mod",
	"go.sum": "go-mod",
	gemfile: "ruby",
	"gemfile.lock": "ruby",
	rakefile: "ruby",
	"composer.json": "composer",
	"composer.lock": "composer",
	"tsconfig.json": "tsconfig",
	"jsconfig.json": "jsconfig",
	".gitignore": "git",
	".gitattributes": "git",
	".gitmodules": "git",
	".env": "tune",
	".env.local": "tune",
	".env.development": "tune",
	".env.production": "tune",
	".editorconfig": "editorconfig",
	".eslintrc": "eslint",
	".eslintrc.js": "eslint",
	".eslintrc.json": "eslint",
	".eslintrc.yml": "eslint",
	".prettierrc": "prettier",
	".prettierrc.js": "prettier",
	".prettierrc.json": "prettier",
	"prettier.config.js": "prettier",
	"vite.config.ts": "vite",
	"vite.config.js": "vite",
	"webpack.config.js": "webpack",
	"webpack.config.ts": "webpack",
	"rollup.config.js": "rollup",
	"rollup.config.ts": "rollup",
	"svelte.config.js": "svelte",
	"svelte.config.ts": "svelte",
	"tailwind.config.js": "tailwindcss",
	"tailwind.config.ts": "tailwindcss",
	"postcss.config.js": "postcss",
	"vitest.config.ts": "vitest",
	"vitest.config.js": "vitest",
	"jest.config.js": "jest",
	"jest.config.ts": "jest",
	license: "license",
	"license.md": "license",
	"license.txt": "license",
	readme: "readme",
	"readme.md": "readme",
	"readme.txt": "readme",
	changelog: "changelog",
	"changelog.md": "changelog",
	todo: "todo",
	"todo.md": "todo",
	"turbo.json": "turborepo",
	"biome.json": "biome",
	".nvmrc": "nodejs",
	".node-version": "nodejs",
	"deno.json": "deno",
	"deno.jsonc": "deno",
};

const FALLBACK_ICON = "file";
const FOLDER_ICON = "folder";

/**
 * Get icon name for a file extension.
 */
export function getFileIconName(extension: string): string {
	const ext = extension.toLowerCase().replace(/^\./, "");
	return extensionToIcon[ext] ?? FALLBACK_ICON;
}

/**
 * Get icon name for a specific filename.
 */
export function getFilenameIconName(filename: string): string | undefined {
	const lower = filename.toLowerCase();
	return filenameToIcon[lower];
}

/**
 * Get the full icon source path for a file.
 * Checks filename first, then falls back to extension.
 * @param basePath - Base path for icon directory (e.g. "/svgs/icons")
 */
export function getFileIconSrc(
	filenameOrExtension: string,
	basePath: string = "/svgs/icons"
): string {
	const filenameIcon = getFilenameIconName(filenameOrExtension);
	if (filenameIcon) {
		return `${basePath}/${filenameIcon}.svg`;
	}

	let ext = filenameOrExtension;
	if (filenameOrExtension.includes(".")) {
		const parts = filenameOrExtension.split(".");
		ext = parts[parts.length - 1];
		if (parts.length >= 2 && parts[parts.length - 2] === "d" && ext === "ts") {
			ext = "d.ts";
		}
	}

	const iconName = getFileIconName(ext);
	return `${basePath}/${iconName}.svg`;
}

/**
 * Get the fallback icon source path.
 */
export function getFallbackIconSrc(basePath: string = "/svgs/icons"): string {
	return `${basePath}/${FALLBACK_ICON}.svg`;
}

/**
 * Get folder icon source path.
 */
export function getFolderIconSrc(
	isOpen: boolean = false,
	basePath: string = "/svgs/icons"
): string {
	return `${basePath}/${FOLDER_ICON}${isOpen ? "-open" : ""}.svg`;
}

/**
 * Get a specialized folder icon if available (e.g., folder-node, folder-react).
 */
export function getSpecialFolderIconSrc(
	folderName: string,
	isOpen: boolean = false,
	basePath: string = "/svgs/icons"
): string {
	const specialFolders: Record<string, string> = {
		node_modules: "folder-node",
		src: "folder-src",
		lib: "folder-lib",
		dist: "folder-dist",
		build: "folder-dist",
		out: "folder-dist",
		public: "folder-public",
		static: "folder-public",
		assets: "folder-images",
		images: "folder-images",
		img: "folder-images",
		components: "folder-components",
		pages: "folder-views",
		views: "folder-views",
		routes: "folder-routes",
		api: "folder-api",
		styles: "folder-css",
		css: "folder-css",
		scripts: "folder-scripts",
		js: "folder-javascript",
		ts: "folder-typescript",
		tests: "folder-test",
		test: "folder-test",
		__tests__: "folder-test",
		spec: "folder-test",
		config: "folder-config",
		configs: "folder-config",
		utils: "folder-utils",
		helpers: "folder-helper",
		hooks: "folder-hook",
		types: "folder-typescript",
		interfaces: "folder-interface",
		models: "folder-database",
		services: "folder-src",
		controllers: "folder-controller",
		middleware: "folder-middleware",
		plugins: "folder-plugin",
		docs: "folder-docs",
		documentation: "folder-docs",
		examples: "folder-examples",
		templates: "folder-template",
		layouts: "folder-layout",
		store: "folder-store",
		stores: "folder-store",
		redux: "folder-redux",
		context: "folder-context",
		providers: "folder-context",
		shared: "folder-shared",
		common: "folder-common",
		core: "folder-core",
		packages: "folder-packages",
		modules: "folder-packages",
		vendor: "folder-packages",
		".git": "folder-git",
		".github": "folder-github",
		".vscode": "folder-vscode",
		".idea": "folder-intellij",
		docker: "folder-docker",
		kubernetes: "folder-kubernetes",
		k8s: "folder-kubernetes",
		terraform: "folder-terraform",
		aws: "folder-aws",
		azure: "folder-azure",
		gcp: "folder-gcp",
		android: "folder-android",
		ios: "folder-ios",
		mobile: "folder-mobile",
		server: "folder-server",
		client: "folder-client",
		frontend: "folder-client",
		backend: "folder-server",
		functions: "folder-functions",
		lambda: "folder-functions",
		graphql: "folder-graphql",
		prisma: "folder-prisma",
		supabase: "folder-supabase",
		firebase: "folder-firebase",
		svelte: "folder-svelte",
		react: "folder-react",
		vue: "folder-vue",
		angular: "folder-angular",
		next: "folder-next",
		nuxt: "folder-nuxt",
		astro: "folder-astro",
	};

	const lowerName = folderName.toLowerCase();
	const specialFolder = specialFolders[lowerName];

	if (specialFolder) {
		return `${basePath}/${specialFolder}${isOpen ? "-open" : ""}.svg`;
	}

	return getFolderIconSrc(isOpen, basePath);
}
