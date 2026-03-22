<script lang="ts">
import IconEye from "@tabler/icons-svelte/icons/eye";
import IconEyeOff from "@tabler/icons-svelte/icons/eye-off";
import IconPlus from "@tabler/icons-svelte/icons/plus";
import IconTrash from "@tabler/icons-svelte/icons/trash";
import FloppyDisk from "phosphor-svelte/lib/FloppyDisk";
import SlidersHorizontal from "phosphor-svelte/lib/SlidersHorizontal";
import {
	Button,
	Dialog,
	DialogContent,
	Input,
	PillButton,
} from "@acepe/ui";
import {
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";

interface EnvRow {
	id: string;
	name: string;
	value: string;
	revealed: boolean;
}

interface Props {
	agentId: string;
	agentName: string;
	value: Readonly<Record<string, string>>;
	onSave: (env: Record<string, string>) => void;
}

const BLOCKED_ENV_NAMES = new Set([
	"PATH",
	"_JAVA_OPTIONS",
	"PERL5OPT",
	"NODE_OPTIONS",
	"PYTHONSTARTUP",
	"RUBYOPT",
	"BASH_ENV",
	"ENV",
	"PROMPT_COMMAND",
]);
const BLOCKED_ENV_PREFIXES = ["DYLD_", "LD_"];

let { agentId, agentName, value, onSave }: Props = $props();

let open = $state(false);
let draftRows = $state<EnvRow[]>([]);
let validationError = $state("");
let nextRowId = $state(0);

function createRow(name: string, envValue: string): EnvRow {
	nextRowId += 1;
	return {
		id: `${agentId}-${nextRowId}`,
		name,
		value: envValue,
		revealed: false,
	};
}

function resetDraftRows(): void {
	const rows: EnvRow[] = [];

	for (const [name, envValue] of Object.entries(value)) {
		rows.push(createRow(name, envValue));
	}

	if (rows.length === 0) {
		rows.push(createRow("", ""));
	}

	draftRows = rows;
	validationError = "";
}

function handleOpenChange(nextOpen: boolean): void {
	open = nextOpen;
	if (nextOpen) {
		resetDraftRows();
	}
}

function addRow(): void {
	draftRows = draftRows.concat(createRow("", ""));
}

function removeRow(rowId: string): void {
	const rows = draftRows.filter((row) => row.id !== rowId);
	draftRows = rows.length > 0 ? rows : [createRow("", "")];
}

function updateRowName(rowId: string, nextName: string): void {
	draftRows = draftRows.map((row) =>
		row.id === rowId
			? { id: row.id, name: nextName, value: row.value, revealed: row.revealed }
			: row
	);
}

function updateRowValue(rowId: string, nextValue: string): void {
	draftRows = draftRows.map((row) =>
		row.id === rowId
			? { id: row.id, name: row.name, value: nextValue, revealed: row.revealed }
			: row
	);
}

function toggleReveal(rowId: string): void {
	draftRows = draftRows.map((row) =>
		row.id === rowId
			? { id: row.id, name: row.name, value: row.value, revealed: !row.revealed }
			: row
	);
}

function isBlockedEnvName(name: string): boolean {
	if (BLOCKED_ENV_NAMES.has(name)) {
		return true;
	}

	return BLOCKED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function buildEnvMap(): Record<string, string> | null {
	const nextEnv: Record<string, string> = {};

	for (const row of draftRows) {
		const trimmedName = row.name.trim();
		const hasTypedValue = row.value.length > 0;

		if (trimmedName.length === 0 && !hasTypedValue) {
			continue;
		}

		if (trimmedName.length === 0) {
			validationError = "Each variable needs a name.";
			return null;
		}

		if (trimmedName.includes("=") || trimmedName.includes("\0")) {
			validationError = "Variable names cannot contain '=' or null bytes.";
			return null;
		}

		if (isBlockedEnvName(trimmedName)) {
			validationError = `${trimmedName} is managed by Acepe and cannot be overridden.`;
			return null;
		}

		if (Object.prototype.hasOwnProperty.call(nextEnv, trimmedName)) {
			validationError = `Duplicate variable name: ${trimmedName}`;
			return null;
		}

		nextEnv[trimmedName] = row.value;
	}

	validationError = "";
	return nextEnv;
}

function handleSave(): void {
	const nextEnv = buildEnvMap();
	if (!nextEnv) {
		return;
	}

	onSave(nextEnv);
	open = false;
}
</script>

<Dialog bind:open onOpenChange={handleOpenChange}>
	<button
		type="button"
		class="flex h-7 items-center gap-1.5 px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
		data-header-control
		onclick={() => handleOpenChange(true)}
	>
		<SlidersHorizontal class="size-3.5 shrink-0" weight="fill" />
		Environment
		{#if Object.keys(value).length > 0}
			<span class="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-foreground/70">
				{Object.keys(value).length}
			</span>
		{/if}
	</button>

	<DialogContent
		portalProps={{ disabled: true }}
		showCloseButton={false}
		class="w-[min(80vw,28.75rem)] overflow-hidden border border-border/40 bg-background p-0 shadow-sm"
	>
		<EmbeddedPanelHeader class="bg-accent/5 border-border/40">
			<HeaderTitleCell>
				{#snippet children()}
					<span class="truncate text-[13px] font-medium leading-none text-foreground select-none">
						{agentName} environment
					</span>
				{/snippet}
			</HeaderTitleCell>
			<HeaderActionCell>
				{#snippet children()}
					<CloseAction onClose={() => handleOpenChange(false)} />
				{/snippet}
			</HeaderActionCell>
		</EmbeddedPanelHeader>

		<div class="space-y-3 bg-background px-4 py-3">
			<p class="text-[12px] text-muted-foreground">
				Stored locally on this machine. Values saved here override the same variable from the
				shell when Acepe starts {agentName}.
			</p>

			<div class="flex justify-end">
				<button
					type="button"
					class="flex items-center gap-1.5 px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
					onclick={addRow}
				>
					<IconPlus class="h-3 w-3" />
					Add variable
				</button>
			</div>

			<div class="max-h-[192px] space-y-2 overflow-y-auto">
				{#each draftRows as row (row.id)}
					<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2">
						<Input
							value={row.name}
							placeholder="AZURE_API_KEY"
							class="h-8 px-2 text-[14px] placeholder:text-[14px]"
							oninput={(event) => updateRowName(row.id, event.currentTarget.value)}
						/>
						<div class="relative">
							<Input
								type={row.revealed ? "text" : "password"}
								value={row.value}
								placeholder="Value"
								class="h-8 px-2 pr-10 text-[14px] placeholder:text-[14px]"
								oninput={(event) => updateRowValue(row.id, event.currentTarget.value)}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
								onclick={() => toggleReveal(row.id)}
							>
								{#if row.revealed}
									<IconEyeOff class="h-3.5 w-3.5" />
								{:else}
									<IconEye class="h-3.5 w-3.5" />
								{/if}
							</Button>
						</div>
						<Button
							type="button"
							variant="outline"
							size="icon"
							class="h-8 w-8 border-border/50"
							onclick={addRow}
						>
							<IconPlus class="h-3.5 w-3.5" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							class="h-8 w-8 border-border/50"
							onclick={() => removeRow(row.id)}
						>
							<IconTrash class="h-3.5 w-3.5" />
						</Button>
					</div>
				{/each}
			</div>

			<p class="text-[12px] text-muted-foreground">
				Blocked keys: `PATH`, `NODE_OPTIONS`, `BASH_ENV`, `ENV`, `PROMPT_COMMAND`, `DYLD_*`,
				and `LD_*`.
			</p>

			{#if validationError}
				<p class="text-[12px] text-destructive">{validationError}</p>
			{/if}
		</div>

		<div class="flex justify-end border-t border-border/40 bg-accent/5 px-2 py-1.5">
			<PillButton
				variant="invert"
				size="md"
				class="shrink-0 text-[0.75rem] font-medium"
				onclick={handleSave}
			>
				Save
				{#snippet trailingIcon()}
					<FloppyDisk class="size-3" weight="fill" />
				{/snippet}
			</PillButton>
		</div>
	</DialogContent>
</Dialog>
