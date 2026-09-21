import { Search, X } from 'lucide-react'

/**
 * ช่องค้นหาสำหรับกรองลิสต์ — คุมค่าจากข้างนอก
 * แยกเป็น component เพื่อให้ปุ่มล้างและหน้าตาเหมือนกันทุกที่ที่ใช้
 */
export default function SearchBox({ value, onChange, placeholder = 'ค้นหา...', count }) {
  return (
    <div className="search-box">
      <Search className="search-box-icon" strokeWidth={1.8} aria-hidden="true" />
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
            <X aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
