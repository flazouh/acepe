<script lang="ts">
import {
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
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
			class="fixed start-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-[440px] max-w-[calc(100vw-3rem)] flex flex-col rounded-xl border border-border/40 bg-background shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200"
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

			<div class="flex flex-col gap-3 p-3">
				<div class="space-y-2">
					<div class="px-1">
						<div class="text-sm font-medium text-foreground">{m.setup_scripts_dialog_title()}</div>
						<div class="text-xs text-muted-foreground/60 mt-0.5">
							{projectName}
						</div>
					</div>
					<SetupCommandsEditor {projectPath} />
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
