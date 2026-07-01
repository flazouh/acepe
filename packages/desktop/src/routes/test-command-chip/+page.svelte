<script lang="ts">
import { CommandChip, type CommandChipModel } from "@acepe/ui/agent-panel";

const modelCommandChip: CommandChipModel = {
	command: "/model",
	message: "model",
	stdout: "",
	displayModelName: "Opus 4.8",
	displayModelDescription: "High reasoning",
	isModelCommand: true,
};
</script>

<div class="h-screen w-screen bg-background p-4">
	<div class="max-w-[600px]" data-testid="command-chip-fixture">
		<CommandChip model={modelCommandChip} />
	</div>
</div>
