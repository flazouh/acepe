<script lang="ts">
import { Button } from "@acepe/ui/button";
import {
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import { Terminal } from "phosphor-svelte";
import { Dialog } from "bits-ui";
import * as m from "$lib/messages.js";
import SetupCommandsEditor from "$lib/components/settings-page/sections/worktrees/setup-commands-editor.svelte";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectPath: string;
	projectName: string;
}

let { open, onOpenChange, projectPath, projectName }: Props = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class="fixed start-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-[560px] max-w-[calc(100vw-3rem)] flex max-h-[min(720px,calc(100vh-3rem))] flex-col rounded-2xl border border-border/40 bg-background shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200"
		>
			<EmbeddedPanelHeader>
				<HeaderTitleCell>
					<span class="text-[11px] font-medium text-foreground select-none truncate leading-none">
						{m.settings_worktree_section()} · {projectName}
					</span>
				</HeaderTitleCell>
				<HeaderActionCell>
					<CloseAction onClose={() => onOpenChange(false)} title={m.common_close()} />
				</HeaderActionCell>
			</EmbeddedPanelHeader>

			<div class="flex min-h-0 flex-1 flex-col gap-4 p-4">
				<div class="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 space-y-1">
							<div class="flex items-center gap-2 text-foreground">
								<Terminal size={15} weight="fill" class="shrink-0 text-foreground/80" />
								<div class="text-sm font-medium">{m.setup_scripts_dialog_title()}</div>
							</div>
							<p class="text-[13px] leading-relaxed text-muted-foreground">
								{m.settings_worktrees_setup_description()}
							</p>
						</div>
						<Button variant="headerAction" size="headerAction" disabled class="disabled:opacity-100">
							{projectName}
						</Button>
					</div>
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto pr-1">
					{#key projectPath}
						<SetupCommandsEditor {projectPath} />
					{/key}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
