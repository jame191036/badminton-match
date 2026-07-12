export default function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
      title={isDark ? 'โหมดสว่าง' : 'โหมดมืด'}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.5" />
          <line x1="12" y1="2.5" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="21.5" />
          <line x1="4.2" y1="4.2" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.8" y2="19.8" />
          <line x1="2.5" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="21.5" y2="12" />
          <line x1="4.2" y1="19.8" x2="6" y2="18" />
          <line x1="18" y1="6" x2="19.8" y2="4.2" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.6 15.3A8.5 8.5 0 0 1 9.7 4.4a.75.75 0 0 0-.9-1A9.9 9.9 0 1 0 21.6 16.2a.75.75 0 0 0-1-.9Z" />
        </svg>
      )}
    </button>
  )
}
