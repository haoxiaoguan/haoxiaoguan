import { useEffect } from 'react';
import { useMcpStore } from '../stores/mcpStore';

export function useMcp() {
  const { servers, loading, error, fetchServers } = useMcpStore();

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return { servers, loading, error, refetch: fetchServers };
}
