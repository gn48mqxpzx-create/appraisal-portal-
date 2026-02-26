import { ReactNode } from "react";
import { SideNav } from "./SideNav";
import { TopNav } from "./TopNav";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-gray-100 text-gray-900">
      <SideNav />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopNav />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
