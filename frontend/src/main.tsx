import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import './index.css'

import Layout from './components/Layout/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import DashboardPage from './pages/DashboardPage'
import UploadPage from './pages/UploadPage'
import BatchListPage from './pages/BatchListPage'
import BatchDetailPage from './pages/BatchDetailPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import AccountPage from './pages/AccountPage'
import ClaimFilePage from './pages/ClaimFilePage'
import ClaimFileDetailPage from './pages/ClaimFileDetailPage'
import CpapFixPage from './pages/CpapFixPage'
import Covid19FixPage from './pages/Covid19FixPage'
import RamaSh50Page from './pages/RamaSh50Page'
import TmtFixPage from './pages/TmtFixPage'
import StdCodeFixPage from './pages/StdCodeFixPage'
import OpdFeeFixPage from './pages/OpdFeeFixPage'
import SvDateFixPage from './pages/SvDateFixPage'
import LivePrescreenPage from './pages/LivePrescreenPage'
import { getAuthToken } from './lib/session'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function ProtectedApp() {
  const token = getAuthToken()
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return (
    <ErrorBoundary>
      <Layout />
    </ErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedApp />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/live-prescreen" element={<LivePrescreenPage />} />
            <Route path="/batches" element={<BatchListPage />} />
            <Route path="/batches/:batchId" element={<BatchDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/settings" element={<SettingsPage view="rules" />} />
            <Route path="/system-settings" element={<SettingsPage view="system" />} />
            <Route path="/claim-files" element={<ClaimFilePage />} />
            <Route path="/claim-files/:sessionId" element={<ClaimFileDetailPage />} />
            <Route path="/cpap-fix" element={<CpapFixPage />} />
            <Route path="/covid19-fix" element={<Covid19FixPage />} />
            <Route path="/rama-sh50" element={<RamaSh50Page />} />
            <Route path="/tmt-fix" element={<TmtFixPage />} />
            <Route path="/stdcode-fix" element={<StdCodeFixPage />} />
            <Route path="/opd-fee-fix" element={<OpdFeeFixPage />} />
            <Route path="/svdate-fix" element={<SvDateFixPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{
        duration: 4000,
        style: { fontFamily: 'IBM Plex Sans Thai, Sarabun, sans-serif' },
      }} />
    </QueryClientProvider>
  </React.StrictMode>
)
