<script lang="ts">
/**
 * Git Viewer demo for the homepage features section.
 * Shows PR and commit diffs with a toggle between the two.
 */
import { GitViewer, type GitCommitData, type GitPrData } from "@acepe/ui";
import GitFeaturesDemo from "./git-features-demo.svelte";

const ICON_BASE_PATH = "/svgs/icons";

const pr: GitPrData = {
	number: 47,
	title: "Migrate authentication to JWT tokens",
	author: "claude-agent",
	state: "open",
	description:
		"Replaces session cookies with stateless JWT tokens.\nAdds refresh token rotation and updates all auth middleware.",
	files: [
		{ path: "src/lib/auth/jwt.ts", status: "added", additions: 54, deletions: 0 },
		{ path: "src/lib/auth/session.ts", status: "deleted", additions: 0, deletions: 38 },
		{ path: "src/middleware/auth.ts", status: "modified", additions: 18, deletions: 24 },
		{ path: "src/routes/api/login/+server.ts", status: "modified", additions: 12, deletions: 8 },
		{ path: "src/routes/api/refresh/+server.ts", status: "added", additions: 31, deletions: 0 },
		{ path: "src/lib/stores/auth.ts", status: "modified", additions: 9, deletions: 14 },
	],
	githubUrl: "https://github.com/example/project/pull/47",
};

const commit: GitCommitData = {
	sha: "e8224481b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8",
	shortSha: "e822448",
	message: "feat: add JWT service with sign and verify",
	messageBody:
		"Creates src/lib/auth/jwt.ts using the jose library.\nImplements signToken() with 15m expiry and verifyToken() for middleware use.",
	author: "Claude",
	authorEmail: "agent@acepe.dev",
	date: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
	files: [
		{ path: "src/lib/auth/jwt.ts", status: "added", additions: 54, deletions: 0 },
		{ path: "src/lib/auth/types.ts", status: "modified", additions: 8, deletions: 2 },
		{ path: "package.json", status: "modified", additions: 1, deletions: 0 },
	],
	githubUrl: "https://github.com/example/project/commit/e822448",
};

const PR_DIFFS: Record<string, string> = {
	"src/lib/auth/jwt.ts": [
		"+ import { SignJWT, jwtVerify } from 'jose';",
		"+",
		"+ const secret = new TextEncoder().encode(process.env.JWT_SECRET);",
		"+",
		"+ export async function signToken(payload: Record<string, unknown>) {",
		"+   return new SignJWT(payload)",
		"+     .setProtectedHeader({ alg: 'HS256' })",
		"+     .setExpirationTime('15m')",
		"+     .sign(secret);",
		"+ }",
		"+",
		"+ export async function verifyToken(token: string) {",
		"+   const { payload } = await jwtVerify(token, secret);",
		"+   return payload;",
		"+ }",
	].join("\n"),
	"src/middleware/auth.ts": [
		"  import type { RequestHandler } from '@sveltejs/kit';",
		"- import { validateSession } from '$lib/auth/session.js';",
		"+ import { verifyToken } from '$lib/auth/jwt.js';",
		"",
		"  export const authenticate: RequestHandler = async ({ request, locals }) => {",
		"-   const sessionId = request.headers.get('x-session-id');",
		"-   if (!sessionId) return unauthorized();",
		"-   const session = await validateSession(sessionId);",
		"-   if (!session) return unauthorized();",
		"-   locals.user = session.user;",
		"+   const auth = request.headers.get('authorization');",
		"+   if (!auth?.startsWith('Bearer ')) return unauthorized();",
		"+   const token = auth.slice(7);",
		"+   locals.user = await verifyToken(token);",
		"  };",
	].join("\n"),
};

const COMMIT_DIFFS: Record<string, string> = PR_DIFFS;

type ViewType = "panel" | "pr" | "commit";
let viewType = $state<ViewType>("panel");
let prSelectedFile = $state(pr.files[0].path);
let commitSelectedFile = $state(commit.files[0].path);
let viewMode = $state<"inline" | "side-by-side">("inline");

function handleSelectFile(path: string) {
	if (viewType === "pr") prSelectedFile = path;
	else commitSelectedFile = path;
}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<!-- Git Panel / PR / Commit toggle -->
	<div class="flex shrink-0 gap-1 border-b border-border/30 bg-muted/30 px-3 py-1.5">
		{#each [{ id: 'panel', label: 'Git Panel' }, { id: 'pr', label: 'Pull Request' }, { id: 'commit', label: 'Commit' }] as tab}
			<button
				class="rounded-full px-3 py-0.5 text-xs font-medium transition-colors"
				class:bg-foreground={viewType === tab.id}
				class:text-background={viewType === tab.id}
				class:text-muted-foreground={viewType !== tab.id}
				class:hover:text-foreground={viewType !== tab.id}
				onclick={() => (viewType = tab.id as ViewType)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Viewer -->
	<div class="min-h-0 flex-1">
		{#if viewType === 'panel'}
			<GitFeaturesDemo />
		{:else if viewType === 'pr'}
			<GitViewer
				data={{ type: 'pr', pr }}
				selectedFile={prSelectedFile}
				{viewMode}
				iconBasePath={ICON_BASE_PATH}
				onSelectFile={handleSelectFile}
				onChangeViewMode={(mode) => (viewMode = mode)}
			>
				{#snippet diffContent({ file })}
					{@const diff = PR_DIFFS[file.path]}
					{#if diff}
						<div class="p-2 font-mono text-[11px] leading-relaxed">
							{#each diff.split('\n') as line, i (i)}
								<div
									class="flex px-2 {line.startsWith('+') ? 'bg-success/10' : line.startsWith('-') ? 'bg-destructive/10' : ''}"
								>
									<span class="w-4 shrink-0 select-none text-center">
										{#if line.startsWith('+')}<span class="text-success">+</span>
										{:else if line.startsWith('-')}<span class="text-destructive">-</span>
										{:else}&nbsp;{/if}
									</span>
									<code class="bg-transparent p-0 text-inherit"
										>{line.startsWith('+') || line.startsWith('-')
											? line.slice(1)
											: line}</code
									>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
							No diff available
						</div>
					{/if}
				{/snippet}
			</GitViewer>
		{:else if viewType === 'commit'}
			<GitViewer
				data={{ type: 'commit', commit }}
				selectedFile={commitSelectedFile}
				{viewMode}
				iconBasePath={ICON_BASE_PATH}
				onSelectFile={handleSelectFile}
				onChangeViewMode={(mode) => (viewMode = mode)}
			>
				{#snippet diffContent({ file })}
					{@const diff = COMMIT_DIFFS[file.path]}
					{#if diff}
						<div class="p-2 font-mono text-[11px] leading-relaxed">
							{#each diff.split('\n') as line, i (i)}
								<div
									class="flex px-2 {line.startsWith('+') ? 'bg-success/10' : line.startsWith('-') ? 'bg-destructive/10' : ''}"
								>
									<span class="w-4 shrink-0 select-none text-center">
										{#if line.startsWith('+')}<span class="text-success">+</span>
										{:else if line.startsWith('-')}<span class="text-destructive">-</span>
										{:else}&nbsp;{/if}
									</span>
									<code class="bg-transparent p-0 text-inherit"
										>{line.startsWith('+') || line.startsWith('-')
											? line.slice(1)
											: line}</code
									>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
							No diff available
						</div>
					{/if}
				{/snippet}
			</GitViewer>
		{/if}
	</div>
</div>
