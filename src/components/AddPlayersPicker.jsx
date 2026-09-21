import { useState } from 'react'
import { useMembers } from '../hooks/useMembers'
import SearchBox from './SearchBox'
import AsyncButton from './AsyncButton'
import { skillLabel } from '../utils/pairing'

/**
 * เลือกคนจากรายชื่อหลักเข้าวันเล่น — สำหรับคนที่มาเพิ่มหน้างาน
 * หรือตอนสร้างวันเล่นลืมติ๊กไว้
 *
 * ส่งชื่อกับระดับมือเข้า add_player เหมือนการพิมพ์ชื่อใหม่ ไม่ได้ใช้ RPC แยก
 * เพราะ add_player upsert สมาชิกด้วยชื่อ (ไม่สนตัวพิมพ์) อยู่แล้ว
 * ส่งชื่อที่มีอยู่เข้าไปจึงผูกกับสมาชิกคนเดิม ไม่เกิดคนซ้ำ
 */
export default function AddPlayersPicker({ ownerId, players, onAdd }) {
  const { members, loading } = useMembers(ownerId)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  // คนที่ลงชื่อในวันนี้แล้ว ไม่ต้องเอามาให้เลือกซ้ำ
  // (รวมคนที่กด "ไม่มา" ด้วย — เขาอยู่ในวันนี้แล้ว แค่ไม่ได้มา
  //  ถ้าจะเอากลับเข้าคิวให้กด "มาแล้ว" ในลิสต์ ไม่ใช่เพิ่มใหม่)
  const alreadyIn = new Set(players.map((p) => p.memberId).filter(Boolean))
  const available = members.filter((m) => !alreadyIn.has(m.id))

  const q = query.trim().toLowerCase()
  const shown = q
    ? available.filter((m) => `${m.name} ${m.note ?? ''}`.toLowerCase().includes(q))
    : available

  async function add(member) {
    setError('')
    try {
      await onAdd(member.name, member.skill)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return null

  if (!open) {
    return (
      <button className="btn-ghost add-from-list" type="button" onClick={() => setOpen(true)}>
        + เลือกจากรายชื่อ
        {available.length > 0 && <span className="tab-count mono">{available.length}</span>}
      </button>
    )
  }

  return (
    <div className="picker-panel">
      <div className="picker-head">
        <span className="field-label">เลือกจากรายชื่อ</span>
        <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>
          ปิด
        </button>
      </div>

      {available.length === 0 ? (
        <p className="empty-text">
          {members.length === 0
            ? 'ยังไม่มีรายชื่อในข้อมูลหลัก — พิมพ์ชื่อในช่องด้านบนเพื่อเพิ่มคนใหม่ได้เลย'
            : 'ทุกคนในรายชื่อลงชื่อวันนี้ครบแล้ว'}
        </p>
      ) : (
        <>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="ค้นหาชื่อ..."
            count={`${shown.length} คน`}
          />

          {shown.length === 0 ? (
            <p className="empty-text">ไม่พบชื่อที่ค้นหา</p>
          ) : (
            <div className="member-picker">
              {shown.map((m) => (
                <AsyncButton
                  key={m.id}
                  className="member-chip"
                  onClick={() => add(m)}
                  title={`เพิ่ม ${m.name} เข้าวันนี้`}
                >
                  <span>{m.name}</span>
                  <span className={`skill-chip skill-${m.skill}`}>
                    {skillLabel(m.skill)}
                  </span>
                </AsyncButton>
              ))}
            </div>
          )}
        </>
      )}

      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}
