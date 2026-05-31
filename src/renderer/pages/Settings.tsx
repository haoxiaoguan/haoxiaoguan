import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useSettingsStore, usePlatformStore } from '../stores';

/** 设置区布局容器：加载设置数据，渲染子页 Outlet。 */
export default function Settings() {
  const { loadSettings } = useSettingsStore();
  const { fetchPlatforms } = usePlatformStore();

  useEffect(() => {
    loadSettings();
    fetchPlatforms();
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <Outlet />
    </div>
  );
}
