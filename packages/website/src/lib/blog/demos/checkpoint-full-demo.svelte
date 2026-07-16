<script lang="ts">
/**
 * Demo: Full Checkpoint Timeline
 * Shows 3 checkpoints with expand/collapse and file lists using @acepe/ui components.
 */
import {
	CheckpointTimeline,
	FilePathBadge,
	type CheckpointData,
	type CheckpointFile,
	type CheckpointState,
	type FileRowState,
	type FileDiff,
} from "@acepe/ui";
import { SvelteMap } from "svelte/reactivity";

const ICON_BASE_PATH = "/svgs/icons";

// Mock checkpoint data
const checkpoints: CheckpointData[] = [
	{
		id: "cp3",
		number: 3,
		message: "Add session management",
		timestamp: Date.now() - 5 * 60 * 1000,
		fileCount: 3,
		totalInsertions: 156,
		totalDeletions: 8,
		isAuto: true,
	},
	{
		id: "cp2",
		number: 2,
		message: "Fix login validation",
		timestamp: Date.now() - 15 * 60 * 1000,
		fileCount: 2,
		totalInsertions: 45,
		totalDeletions: 23,
		isAuto: true,
	},
	{
		id: "cp1",
		number: 1,
		message: "Add user authentication",
		timestamp: Date.now() - 30 * 60 * 1000,
		fileCount: 5,
		totalInsertions: 234,
		totalDeletions: 12,
		isAuto: true,
	},
];

// Mock files for each checkpoint
const checkpointFiles: Record<string, CheckpointFile[]> = {
	cp3: [
		{ id: "f3-1", filePath: "src/lib/session/store.ts", linesAdded: 89, linesRemoved: 0 },
		{ id: "f3-2", filePath: "src/lib/session/types.ts", linesAdded: 45, linesRemoved: 0 },
		{ id: "f3-3", filePath: "src/routes/+layout.server.ts", linesAdded: 22, linesRemoved: 8 },
	],
	cp2: [
		{ id: "f2-1", filePath: "src/lib/auth/validation.ts", linesAdded: 34, linesRemoved: 18 },
		{ id: "f2-2", filePath: "src/lib/auth/validation.test.ts", linesAdded: 11, linesRemoved: 5 },
	],
	cp1: [
		{ id: "f1-1", filePath: "src/lib/auth/service.ts", linesAdded: 112, linesRemoved: 0 },
		{ id: "f1-2", filePath: "src/lib/auth/types.ts", linesAdded: 67, linesRemoved: 0 },
		{ id: "f1-3", filePath: "src/routes/login/+page.svelte", linesAdded: 45, linesRemoved: 0 },
		{ id: "f1-4", filePath: "package.json", linesAdded: 8, linesRemoved: 4 },
		{ id: "f1-5", filePath: "README.md", linesAdded: 2, linesRemoved: 8 },
	],
};

// Mock diff content for files
const mockDiffs: Record<string, FileDiff> = {
	"f3-1": {
		filePath: "src/lib/session/store.ts",
		content: `+ import { writable } from 'svelte/store';
+
+ export interface Session {
+   id: string;
+   userId: string;
+   createdAt: Date;
+   expiresAt: Date;
+ }
+
+ export const sessionStore = writable<Session | null>(null);`,
		language: "typescript",
	},
	"f2-1": {
		filePath: "src/lib/auth/validation.ts",
		content: `  export function validateEmail(email: string): boolean {
-   return email.includes('@');
+   const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
+   return emailRegex.test(email);
  }

  export function validatePassword(password: string): boolean {
-   return password.length > 0;
+   return password.length >= 8 && /[A-Z]/.test(password);
  }`,
		language: "typescript",
	},
};

// State management with SvelteMap for reactivity
let checkpointStates = $state(new SvelteMap<string, CheckpointState>());
let fileStates = $state(new SvelteMap<string, FileRowState>());

// Initialize checkpoint states (all expanded by default)
$effect(() => {
	for (const cp of checkpoints) {
		if (!checkpointStates.has(cp.id)) {
			checkpointStates.set(cp.id, {
				isExpanded: true,
				isLoadingFiles: false,
				isReverting: false,
				files: checkpointFiles[cp.id] ?? [],
			});
		}
	}
});

function handleToggleCheckpoint(checkpointId: string) {
	const current = checkpointStates.get(checkpointId);
	if (current) {
		checkpointStates.set(checkpointId, {
			...current,
			isExpanded: !current.isExpanded,
		});
	}
}

function handleToggleFileDiff(_checkpointId: string, fileId: string) {
	const current = fileStates.get(fileId);
	const isExpanded = !current?.isDiffExpanded;

	if (isExpanded && !current?.diff) {
		fileStates.set(fileId, {
			isDiffExpanded: true,
			isLoadingDiff: true,
			isReverting: false,
			diff: null,
		});

		setTimeout(() => {
			fileStates.set(fileId, {
				isDiffExpanded: true,
				isLoadingDiff: false,
				isReverting: false,
				diff: mockDiffs[fileId] ?? {
					filePath: "",
					content: "// No diff available for demo",
					language: "text",
				},
			});
		}, 300);
	} else {
		fileStates.set(fileId, {
			isDiffExpanded: isExpanded,
			isLoadingDiff: false,
			isReverting: false,
			diff: current?.diff ?? null,
		});
	}
}
</script>

<div class="demo-container">
	<p class="demo-hint">
		Click on any checkpoint to expand/collapse. Click on a file row to see the diff content.
	</p>

	<CheckpointTimeline
		{checkpoints}
		{checkpointStates}
		{fileStates}
		showRevertButtons={false}
		allowFileDiffExpand={true}
		onToggleCheckpoint={handleToggleCheckpoint}
		onToggleFileDiff={handleToggleFileDiff}
	>
		{#snippet fileDisplay({ file })}
			<FilePathBadge
				filePath={file.filePath}
				iconBasePath={ICON_BASE_PATH}
				linesAdded={file.linesAdded ?? 0}
				linesRemoved={file.linesRemoved ?? 0}
				interactive={false}
			/>
		{/snippet}
	</CheckpointTimeline>
</div>

<style>
	.demo-container {
		max-width: 800px;
		margin: 2rem auto;
		padding: 1.5rem;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.5);
		background: hsl(var(--card) / 0.3);
	}

	.demo-hint {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		text-align: center;
	}
</style>
