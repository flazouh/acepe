<script lang="ts">
/**
 * Demo: Single Checkpoint Card
 * Shows one checkpoint in detail using @acepe/ui components.
 */
import {
	CheckpointCard,
	FilePathBadge,
	type CheckpointData,
	type CheckpointFile,
	type FileRowState,
	type FileDiff,
} from "@acepe/ui";
import { SvelteMap } from "svelte/reactivity";

const ICON_BASE_PATH = "/svgs/icons";

const checkpoint: CheckpointData = {
	id: "demo-cp",
	number: 7,
	message: "Refactor database queries for performance",
	timestamp: Date.now() - 2 * 60 * 1000,
	fileCount: 4,
	totalInsertions: 78,
	totalDeletions: 45,
	isAuto: true,
};

const files: CheckpointFile[] = [
	{ id: "df-1", filePath: "src/lib/db/queries.ts", linesAdded: 42, linesRemoved: 28 },
	{ id: "df-2", filePath: "src/lib/db/connection.ts", linesAdded: 18, linesRemoved: 12 },
	{ id: "df-3", filePath: "src/lib/db/types.ts", linesAdded: 15, linesRemoved: 3 },
	{ id: "df-4", filePath: "src/lib/db/index.ts", linesAdded: 3, linesRemoved: 2 },
];

const mockDiff: FileDiff = {
	filePath: "src/lib/db/queries.ts",
	content: `  export async function getUsers(limit: number) {
-   const users = await db.query('SELECT * FROM users');
-   return users.slice(0, limit);
+   return db.query('SELECT * FROM users LIMIT $1', [limit]);
  }

  export async function getUserById(id: string) {
-   const users = await db.query('SELECT * FROM users');
-   return users.find(u => u.id === id);
+   const [user] = await db.query('SELECT * FROM users WHERE id = $1', [id]);
+   return user ?? null;
  }`,
	language: "typescript",
};

let isExpanded = $state(true);
let fileStates = $state(new SvelteMap<string, FileRowState>());

function handleToggleFileDiff(fileId: string) {
	const current = fileStates.get(fileId);
	const newExpanded = !current?.isDiffExpanded;

	if (newExpanded && !current?.diff) {
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
				diff: mockDiff,
			});
		}, 300);
	} else {
		fileStates.set(fileId, {
			isDiffExpanded: newExpanded,
			isLoadingDiff: false,
			isReverting: false,
			diff: current?.diff ?? null,
		});
	}
}
</script>

<div class="demo-container">
	<p class="demo-hint">
		This shows a single checkpoint card. Click the header to expand/collapse, or click a file to see
		its diff.
	</p>

	<div class="card-wrapper">
		<CheckpointCard
			{checkpoint}
			{files}
			{fileStates}
			{isExpanded}
			showRevertButton={false}
			allowFileDiffExpand={true}
			onToggleExpand={() => (isExpanded = !isExpanded)}
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
		</CheckpointCard>
	</div>
</div>

<style>
	.demo-container {
		max-width: 600px;
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

	.card-wrapper {
		max-width: 100%;
	}
</style>
