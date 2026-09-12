import { NavLink, Outlet } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'
import UserMenu from './UserMenu'

const NAV = [
  { to: '/', label: 'ก๊วนของฉัน', end: true },
  { to: '/master', label: 'ข้อมูลหลัก', end: false },
]

/**
 * แถบบนบางติดขอบจอ — ไม่ทำเป็นลิ้นชักสไลด์ข้าง เพราะมีลิงก์แค่ 2 อัน
 * ที่กดบ่อยทั้งคู่ ซ่อนไว้ในลิ้นชักจะกลายเป็นเพิ่มคลิกทุกครั้งที่สลับหน้า
 */
export default function AppLayout({ user, theme, onToggleTheme, onSignOut }) {
  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <NavLink to="/" className="brand" end>
            <span className="brand-mark" aria-hidden="true">
              🏸
            </span>
            <span className="brand-name">จับคู่ลงคอร์ต</span>
          </NavLink>

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

          <div className="app-bar-right">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <UserMenu email={user?.email} onSignOut={onSignOut} />
          </div>
        </div>
      </header>

      <div className="app-shell">
        <Outlet context={{ user }} />
      </div>
    </>
  )
}
