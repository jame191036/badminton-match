import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'
import AppLayout from './components/AppLayout'
import Login from './components/Login'
import ResetPassword from './components/ResetPassword'
import { ConfirmProvider } from './components/ConfirmProvider'
import ClubListPage from './pages/ClubListPage'
import MasterDataPage from './pages/MasterDataPage'
import ClubPage from './pages/ClubPage'
import NewPlayDayPage from './pages/NewPlayDayPage'
import PlayDayPage from './pages/PlayDayPage'
import './app.css'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const {
    user,
    loading: authLoading,
    recovery,
    signIn,
    signUp,
    sendPasswordReset,
    updatePassword,
    signOut,
  } = useAuth()

  if (authLoading) {
    return (
      <div className="auth-loading" role="status" aria-label="กำลังโหลด">
        <span className="auth-spinner" />
      </div>
    )
  }

  // ผู้ใช้กดลิงก์ตั้งรหัสผ่านใหม่จากอีเมล — ต้องตั้งรหัสก่อนถึงจะใช้งานต่อได้
  if (recovery) {
    return (
      <ResetPassword
        onSubmit={updatePassword}
        onCancel={signOut}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    )
  }

  if (!user) {
    return (
      <Login
        onSignIn={signIn}
        onSignUp={signUp}
        onForgotPassword={sendPasswordReset}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    )
  }

  return (
    <ConfirmProvider>
      <Routes>
        <Route
          element={
            <AppLayout user={user} theme={theme} onToggleTheme={toggleTheme} onSignOut={signOut} />
          }
        >
          <Route index element={<ClubListPage />} />
          <Route path="master" element={<MasterDataPage />} />
          <Route path="club/:clubId" element={<ClubPage />} />
          <Route path="club/:clubId/new" element={<NewPlayDayPage />} />
          <Route path="club/:clubId/day/:sessionId" element={<PlayDayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConfirmProvider>
  )
}
