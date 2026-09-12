import { useEffect, useRef, useState } from 'react'

/**
 * ช่องเลือกแบบพิมพ์ค้นหาได้ ใช้แทน <select> เวลาตัวเลือกเยอะ
 *
 * ไม่ใช้ <select> เพราะรายการยาวๆ ต้องเลื่อนหาทีละอัน และ select ของ
 * เบราว์เซอร์ค้นด้วยการพิมพ์ได้แค่ "ขึ้นต้นด้วย" ซึ่งใช้กับชื่อไทยไม่ค่อยได้ผล
 *
 * options: [{ value, label, hint? }]
 */
export default function SearchSelect({
  value,
  options,
  onChange,
  placeholder = 'เลือก',
  emptyLabel = 'ไม่ระบุ',
  noResultLabel = 'ไม่พบที่ค้นหา',
  disabled = false,
  allowEmpty = true,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)

  const selected = options.find((o) => o.value === value)
  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
    : options

  // ปิดเมื่อคลิกที่อื่น — ไม่งั้นรายการจะค้างเปิดทับส่วนอื่นของฟอร์ม
  useEffect(() => {
    if (!open) return

    function onPointerDown(e) {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function pick(next) {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={`search-select${disabled ? ' is-disabled' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="search-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setQuery('')
        }}
      >
        <span className={selected ? '' : 'is-placeholder'}>{selected?.label ?? placeholder}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="search-select-pop">
          <input
            type="text"
            className="search-select-input"
            placeholder="พิมพ์เพื่อค้นหา..."
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              // Enter = เลือกตัวแรกที่ค้นเจอ ให้พิมพ์แล้วกดจบได้เลย
              if (e.key === 'Enter') {
                e.preventDefault()
                if (filtered.length > 0) pick(filtered[0].value)
              }
            }}
          />

          <ul className="search-select-list" role="listbox">
            {allowEmpty && !q && (
              <li>
                <button
                  type="button"
                  className={`search-select-option${!value ? ' is-on' : ''}`}
                  onClick={() => pick('')}
                >
                  — {emptyLabel} —
                </button>
              </li>
            )}

            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`search-select-option${o.value === value ? ' is-on' : ''}`}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                  {o.hint && <span className="search-select-hint">{o.hint}</span>}
                </button>
              </li>
            ))}

            {filtered.length === 0 && <li className="search-select-empty">{noResultLabel}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
