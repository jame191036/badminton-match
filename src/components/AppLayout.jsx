import { NavLink, Outlet } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'

const NAV = [
  { to: '/', label: 'ก๊วนของฉัน', end: true },
  { to: '/master', label: 'ข้อมูลหลัก', end: false },
]

export default function AppLayout({ user, theme, onToggleTheme, onSignOut }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top">
          <button className="btn-ghost btn-on-dark" onClick={onSignOut}>
            ออกจากระบบ
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>

        <div className="header-inner">
          <span className="eyebrow mono">จัดก๊วนแบด</span>
          <h1 className="display">จับคู่ลงคอร์ต 🏸</h1>
          <p className="header-sub">{user?.email}</p>
        </div>

        <nav className="app-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <Outlet context={{ user }} />
    </div>
  )
}
