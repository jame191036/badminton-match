import { useEffect, useId, useRef, useState } from 'react'

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
  // แถวที่ไฮไลต์อยู่ตอนกดลูกศร — -1 คือยังไม่ได้เลื่อนไปไหน
  const [active, setActive] = useState(-1)
  const boxRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value)
  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
    : options

  // รวมแถว "ไม่ระบุ" เข้ามาเป็นแถวหนึ่งของรายการ ลูกศรจะได้เลื่อนถึงมันด้วย
  const rows = allowEmpty && !q ? [{ value: '', label: `— ${emptyLabel} —` }, ...filtered] : filtered

  // ปิดเมื่อคลิกที่อื่น — ไม่งั้นรายการจะค้างเปิดทับส่วนอื่นของฟอร์ม
  useEffect(() => {
    if (!open) return

    function onPointerDown(e) {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // เลื่อนแถวที่ไฮไลต์ให้อยู่ในกรอบเสมอ ไม่งั้นกดลูกศรลงไปเรื่อยๆ แล้วไฮไลต์
  // จะหลุดออกนอกจอทั้งที่รายการยังเลื่อนไม่ตาม
  useEffect(() => {
    if (active < 0) return
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(next) {
    onChange(next)
    setOpen(false)
    setQuery('')
    setActive(-1)
  }

  function toggle(next) {
    setOpen(next)
    setQuery('')
    setActive(-1)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      toggle(false)
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault() // กันเคอร์เซอร์ในช่องค้นหากระโดดหัว/ท้ายข้อความ
      if (rows.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      // วนรอบ: จากท้ายสุดกดลงต่อก็กลับมาบนสุด หาไม่เจอจะได้ไม่ต้องกดย้อน
      setActive((i) => (i + step + rows.length) % rows.length)
      return
    }

    // Enter = เลือกแถวที่ไฮไลต์ ถ้ายังไม่ได้เลื่อนก็เอาตัวแรกที่ค้นเจอ
    if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[active] ?? (q ? filtered[0] : null)
      if (row) pick(row.value)
    }
  }

  return (
    <div className={`search-select${disabled ? ' is-disabled' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="search-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => toggle(!open)}
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
            role="combobox"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(-1) // ผลการค้นหาเปลี่ยน ไฮไลต์เดิมชี้คนละคนแล้ว
            }}
            onKeyDown={onKeyDown}
          />

          <ul className="search-select-list" id={listId} role="listbox" ref={listRef}>
            {rows.map((o, i) => (
              <li key={o.value || '__empty'}>
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  className={`search-select-option${o.value === value ? ' is-on' : ''}${
                    i === active ? ' is-active' : ''
                  }`}
                  // เมาส์ไปทางไหน ไฮไลต์ตามไปทางนั้น จะได้ไม่มีสองแถวสว่างพร้อมกัน
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                  {o.hint && <span className="search-select-hint">{o.hint}</span>}
                </button>
              </li>
            ))}

            {rows.length === 0 && <li className="search-select-empty">{noResultLabel}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
