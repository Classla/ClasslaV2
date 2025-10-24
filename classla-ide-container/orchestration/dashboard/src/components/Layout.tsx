import { Outlet, NavLink } from "react-router-dom";

export default function Layout() {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? "bg-blue-700 text-white"
        : "text-blue-100 hover:bg-blue-600 hover:text-white"
    }`;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-white">
                IDE Orchestration
              </h1>
            </div>
            <nav className="flex space-x-4">
              <NavLink to="/overview" className={navLinkClass}>
                Overview
              </NavLink>
              <NavLink to="/nodes" className={navLinkClass}>
                Nodes
              </NavLink>
              <NavLink to="/containers" className={navLinkClass}>
                Containers
              </NavLink>
              <NavLink to="/logs" className={navLinkClass}>
                Logs
              </NavLink>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
