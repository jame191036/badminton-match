/**
 * ช่องค้นหาสำหรับกรองลิสต์ — คุมค่าจากข้างนอก
 * แยกเป็น component เพื่อให้ปุ่มล้างและหน้าตาเหมือนกันทุกที่ที่ใช้
 */
export default function SearchBox({ value, onChange, placeholder = 'ค้นหา...', count }) {
  return (
    <div className="search-box">
      <svg className="search-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('')
        }}
      />
      {value && (
        <>
          <span className="search-box-count mono">{count}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => onChange('')}
            aria-label="ล้างคำค้น"
            title="ล้างคำค้น"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}
