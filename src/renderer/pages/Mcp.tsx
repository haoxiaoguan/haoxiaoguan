import { UnifiedMcpPanel } from '../components/mcp/UnifiedMcpPanel';

export default function Mcp() {
  return (
    <div className="flex h-[calc(100vh-98px)] min-h-0 flex-col overflow-hidden px-6 py-5">
      <UnifiedMcpPanel />
    </div>
  );
}
