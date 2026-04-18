<script lang="ts">
import { AgentPanelScrollToBottomButton as SharedAgentPanelScrollToBottomButton } from "@acepe/ui/agent-panel";
interface ScrollToBottomButtonProps {
	/**
	 * Whether the button should be visible.
	 * True when user is not at the bottom of the scroll area.
	 */
	visible: boolean;

	/**
	 * Callback triggered when the button is clicked.
	 */
	onClick: () => void;
}

let { visible, onClick }: ScrollToBottomButtonProps = $props();
</script>

<SharedAgentPanelScrollToBottomButton
	{visible}
	ariaLabel={"Scroll Bottom"}
	{onClick}
/>
