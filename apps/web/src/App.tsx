import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { IntakeUploadPage } from "./pages/IntakeUploadPage";
import { CasesPage } from "./pages/CasesPage";
import { CaseDetailPage } from "./pages/CaseDetailPage";
import { MarketBenchmarksPage } from "./pages/MarketBenchmarksPage";
import { WsllUploadPage } from "./pages/WsllUploadPage";
import { ExportsPage } from "./pages/ExportsPage";

// Protected route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("authToken");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <ProtectedRoute>
            <AppShell>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/intake-upload" element={<IntakeUploadPage />} />
                <Route path="/market" element={<MarketBenchmarksPage />} />
                <Route path="/wsll-upload" element={<WsllUploadPage />} />
                <Route path="/cases" element={<CasesPage />} />
                <Route path="/cases/:id" element={<CaseDetailPage />} />
                <Route path="/exports" element={<ExportsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}