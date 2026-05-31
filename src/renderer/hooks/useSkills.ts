import { useEffect } from 'react';
import { useSkillsStore } from '../stores/skillsStore';

export function useSkills() {
  const { installed, loading, error, fetchInstalled } = useSkillsStore();

  useEffect(() => {
    fetchInstalled();
  }, [fetchInstalled]);

  return { installed, loading, error, refetch: fetchInstalled };
}

export function useSkillsDiscover() {
  const { discoverable, loading, error, fetchDiscoverable } = useSkillsStore();

  useEffect(() => {
    fetchDiscoverable();
  }, [fetchDiscoverable]);

  return { discoverable, loading, error, refetch: fetchDiscoverable };
}
