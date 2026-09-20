import { createBrowserRouter, Navigate } from 'react-router'
import { RequireAuth } from './features/auth/RequireAuth'
import { LoginPage } from './features/auth/LoginPage'
import { AppShell } from './components/AppShell'
import { PatientsPage } from './features/patients/PatientsPage'
import { PatientPage } from './features/patients/PatientPage'
import { ReceiptPage } from './features/payments/ReceiptPage'
import { PlanPage } from './features/plans/PlanPage'
import { TodayPage } from './features/today/TodayPage'
import { AppointmentsPage } from './features/appointments/AppointmentsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { LabsPage } from './features/labs/LabsPage'
import { MaterialsPage } from './features/materials/MaterialsPage'
import { FinancePage } from './features/finance/FinancePage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: 'receipts/:id', element: <ReceiptPage /> },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/today" replace /> },
          { path: 'today', element: <TodayPage /> },
          { path: 'appointments', element: <AppointmentsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'labs', element: <LabsPage /> },
          { path: 'materials', element: <MaterialsPage /> },
          { path: 'finance', element: <FinancePage /> },
          { path: 'patients', element: <PatientsPage /> },
          { path: 'patients/:id', element: <PatientPage /> },
          { path: 'plans/:planId', element: <PlanPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
