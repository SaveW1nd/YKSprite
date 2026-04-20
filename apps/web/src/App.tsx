import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './layout/AdminLayout';
import { AccountsPage } from './pages/AccountsPage';
import { AnswersPage } from './pages/AnswersPage';
import { ApiPage } from './pages/ApiPage';
import { DashboardPage } from './pages/DashboardPage';
import { MonitoringPage } from './pages/MonitoringPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<Navigate replace to="/accounts" />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="answers" element={<AnswersPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="api" element={<ApiPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
