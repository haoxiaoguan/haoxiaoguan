interface AgentToggleRowProps {
  agentId: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function AgentToggleRow({ agentId, enabled, onToggle }: AgentToggleRowProps) {
  return (
    <label className="flex items-center justify-between py-0.5 cursor-pointer">
      <span className="text-xs text-foreground/80">{agentId}</span>
      <input
        type="checkbox"
        className="toggle toggle-xs toggle-primary"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
    </label>
  );
}
