export interface AgentCardProps {
	agentId: string;
	agentName: string;
	iconSrc: string;
	isAvailable?: boolean;
	isSelected?: boolean;
	onclick?: () => void;
}
