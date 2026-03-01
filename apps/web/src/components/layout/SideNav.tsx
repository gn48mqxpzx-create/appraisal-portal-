import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/intake-upload", label: "Intake Upload" },
  { to: "/wsll-upload", label: "WSLL Upload" },
  { to: "/cases", label: "Cases" },
  { to: "/market", label: "Market Benchmarks" },
  { to: "/exports", label: "Exports" }
];

export function SideNav() {
  return (
    <aside className="w-64 border-r border-gray-200 bg-white p-4">
      <div className="mb-8 text-lg font-semibold text-gray-900">Appraisal Portal</div>
      <nav className="space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                "block rounded-md px-3 py-2 text-sm",
                isActive ? "bg-primary-100 text-primary-700" : "text-gray-700 hover:bg-gray-100"
              ].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
