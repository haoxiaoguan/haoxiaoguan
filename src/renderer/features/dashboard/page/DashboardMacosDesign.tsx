const MACOS_DASHBOARD_IMAGE = '/docs/superpowers/design/macos-dashboard@2x.png';

export default function DashboardMacosDesign() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-white" data-testid="dashboard-design-fixture">
      <img
        data-testid="dashboard-root-card"
        src={MACOS_DASHBOARD_IMAGE}
        alt="macOS dashboard design reference"
        className="h-full w-full select-none object-fill pointer-events-none"
        draggable={false}
      />
    </div>
  );
}
