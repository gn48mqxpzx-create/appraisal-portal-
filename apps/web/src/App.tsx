import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { IntakeUploadPage } from "./pages/IntakeUploadPage";
import { CasesPage } from "./pages/CasesPage";
import { CaseDetailPage } from "./pages/CaseDetailPage";
import { MarketBenchmarksPage } from "./pages/MarketBenchmarksPage";
import { WsllUploadPage } from "./pages/WsllUploadPage";
import { ExportsPage } from "./pages/ExportsPage";

export default function App() {
  return (
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
  );
}