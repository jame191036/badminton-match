import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useClubs } from '../hooks/useClubs'
import { useMembers } from '../hooks/useMembers'
import { useMasterList } from '../hooks/useMasterList'
import { useShuttleModels } from '../hooks/useShuttleModels'
import EditableName from '../components/EditableName'
import SearchBox from '../components/SearchBox'
import { SkeletonList } from '../components/Skeleton'
import { useConfirm } from '../hooks/useConfirm'
import { SKILL_LEVELS } from '../utils/pairing'
import AsyncButton from '../components/AsyncButton'

const TABS = [
  { id: 'members', label: 'ผู้เล่น' },
  { id: 'venues', label: 'สนาม' },
  { id: 'shuttles', label: 'ยี่ห้อลูกแบด' },
]

export default function MasterDataPage() {
  const { user } = useOutletContext()
  const { clubs } = useClubs(user?.id)
  const [tab, setTab] = useState('members')
  const [ownerId, setOwnerId] = useState(user?.id ?? '')

  /**
   * ข้อมูลหลักผูกกับ "บัญชีเจ้าของก๊วน" ไม่ใช่กับก๊วน
   * ถ้าถูกเชิญไปช่วยจัดก๊วนของคนอื่น ต้องดู/แก้ชุดของเขาได้ด้วย
   * ไม่งั้นหน้านี้จะว่างเปล่าทั้งที่ใช้ข้อมูลของเขาอยู่ตอนจัดวันเล่น
   *
   * ไม่มีชื่อ/อีเมลเจ้าของให้แสดง (authenticated อ่าน auth.users ไม่ได้)
   * เลยใช้ชื่อก๊วนของเขาเป็นป้ายแทน ซึ่งสื่อกว่าอีเมลด้วยซ้ำ
   */
  const owners = [{ id: user?.id, label: 'ของฉัน', mine: true, canEdit: true }]
  for (const club of clubs) {
    if (club.ownerId === user?.id) continue
    // viewer ดูได้อย่างเดียว ถ้าเจ้าของคนเดียวแชร์มาหลายก๊วนคนละบทบาท
    // ให้ยึดบทบาทที่สูงสุด — มีก๊วนไหนที่เป็น editor ก็แก้ข้อมูลหลักได้
    const editable = club.role === 'owner' || club.role === 'editor'
    const found = owners.find((o) => o.id === club.ownerId)
    if (found) {
      found.label = `${found.label}, ${club.name}`
      found.canEdit = found.canEdit || editable
    } else {
      owners.push({ id: club.ownerId, label: club.name, mine: false, canEdit: editable })
    }
  }

  const activeOwner = owners.find((o) => o.id === ownerId) ?? owners[0]
  const canEdit = Boolean(activeOwner?.canEdit)
  // ลบได้เฉพาะข้อมูลของตัวเอง (RLS ฝั่ง DB บังคับอีกชั้นอยู่แล้ว)
  const canDelete = Boolean(activeOwner?.mine)

  return (
    <>
      <section className="panel">
        <h2>ข้อมูลหลัก</h2>
        <p className="panel-lead">
          ตั้งไว้ล่วงหน้าครั้งเดียว แล้วเลือกใช้ตอนจัดวันเล่น — ใช้ร่วมกันได้ทุกก๊วน
        </p>

        {owners.length > 1 && (
          <div className="owner-switch">
            <span className="field-label">ข้อมูลของ</span>
            <div className="auth-tabs" role="tablist">
              {owners.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={activeOwner?.id === o.id}
                  className={`auth-tab${activeOwner?.id === o.id ? ' is-active' : ''}`}
                  onClick={() => setOwnerId(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {!canDelete && (
              <p className="panel-hint">
                {canEdit
                  ? 'คุณเพิ่มและแก้ไขได้ แต่ลบไม่ได้ — สงวนไว้ให้เจ้าของก๊วน'
                  : 'คุณดูได้อย่างเดียว เพราะถูกเชิญมาในฐานะผู้ชม'}
              </p>
            )}
          </div>
        )}

        <div className="tab-bar" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab-btn${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* key = บังคับให้ remount เมื่อสลับเจ้าของ ไม่งั้นคำค้นและฟอร์มค้างข้ามชุด */}
        {tab === 'members' && (
          <MembersTab key={activeOwner?.id}
            userId={activeOwner?.id}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}
        {tab === 'venues' && (
          <VenuesTab key={activeOwner?.id}
            userId={activeOwner?.id}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}
        {tab === 'shuttles' && (
          <ShuttlesTab key={activeOwner?.id}
            userId={activeOwner?.id}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}
      </section>
    </>
  )
}

/* ---------------- ผู้เล่น ---------------- */

function MembersTab({ userId, canEdit, canDelete }) {
  const confirm = useConfirm()
  const { members, loading, error, addMember, updateMember, removeMember } = useMembers(userId)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [skill, setSkill] = useState(2)
  const [query, setQuery] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const shown = filterByQuery(members, query)

  async function handleAdd(e) {
    e.preventDefault()
    setFormError('')
    setBusy(true)
    try {
      await addMember({ name, skill: Number(skill), note })
      setName('')
      setNote('')
      setSkill(2)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {canEdit && (
        <form className="player-form" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="ชื่อผู้เล่น"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="หมายเหตุ เช่น เพื่อนพี่เอ (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <select value={skill} onChange={(e) => setSkill(e.target.value)}>
            {SKILL_LEVELS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
            เพิ่มชื่อ
          </button>
        </form>
      )}

      <MasterError message={formError || error} />

      {members.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="ค้นหาชื่อผู้เล่น..."
          count={`${shown.length}/${members.length}`}
        />
      )}

      {loading ? (
        <SkeletonList count={5} lines={1} />
      ) : members.length === 0 ? (
        <p className="empty-text">ยังไม่มีรายชื่อ — เพิ่มได้ที่ช่องด้านบน หรือจะเพิ่มหน้างานตอนจัดวันเล่นก็ได้</p>
      ) : shown.length === 0 ? (
        <p className="empty-text">ไม่พบชื่อที่ค้นหา</p>
      ) : (
        <ul className="master-list">
          {shown.map((m) => (
            <li key={m.id} className="master-row">
              <div className="master-row-main">
                <EditableName
                  readOnly={!canEdit}
                  label="ชื่อผู้เล่น"
                  fields={[
                    { key: 'name', value: m.name, placeholder: 'ชื่อผู้เล่น', required: true },
                    { key: 'note', value: m.note, placeholder: 'หมายเหตุ' },
                  ]}
                  onSave={(values) => updateMember(m.id, values)}
                >
                  <span className="master-name">{m.name}</span>
                  {m.note && <span className="master-note">{m.note}</span>}
                </EditableName>
                <span className={`skill-chip skill-${m.skill}`}>
                  {SKILL_LEVELS.find((s) => s.value === m.skill)?.label}
                </span>
              </div>
              <div className="master-row-meta mono">
                เล่นแล้ว {m.daysPlayed} วัน · {m.totalGames} เกม
              </div>
              <div className="master-row-actions">
                <select
                  value={m.skill}
                  disabled={!canEdit}
                  aria-label={`ระดับมือของ ${m.name}`}
                  // ต้อง catch เอง — updateMember โยน error และ onChange
                  // ไม่ได้ await ให้ ถ้าไม่ดักจะกลายเป็น unhandled rejection
                  onChange={async (e) => {
                    try {
                      await updateMember(m.id, { default_skill: Number(e.target.value) })
                    } catch (err) {
                      setFormError(err.message)
                    }
                  }}
                >
                  {SKILL_LEVELS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {canDelete && (
                <AsyncButton
                  className="btn-ghost btn-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `ลบ "${m.name}" ออกจากรายชื่อ?`,
                      message: 'ประวัติการเล่นที่ผ่านมายังอยู่ครบ เพราะแต่ละวันเก็บชื่อไว้แยกต่างหาก',
                      confirmLabel: 'ลบชื่อนี้',
                      danger: true,
                    })
                    if (ok) removeMember(m.id)
                  }}
                >
                  ลบ
                </AsyncButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ---------------- สนาม ---------------- */

function VenuesTab({ userId, canEdit, canDelete }) {
  const confirm = useConfirm()
  const { items, loading, error, add, update, remove } = useMasterList('venues', userId)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const shown = filterByQuery(items, query)

  async function handleAdd(e) {
    e.preventDefault()
    setFormError('')
    setBusy(true)
    try {
      await add({ name: name.trim(), note: note.trim() || null })
      setName('')
      setNote('')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="panel-hint">
        &ldquo;สนาม&rdquo; คือสถานที่ที่ไปตี — ส่วนจะจองกี่คอร์ต คอร์ตละกี่ชั่วโมง
        และค่าสนามชั่วโมงละเท่าไหร่ ไปกรอกตอนสร้างวันเล่น
        เพราะราคาเปลี่ยนได้ทุกครั้งที่ไป และยอดของวันที่จ่ายไปแล้วต้องไม่ขยับตาม
      </p>

      {canEdit && (
        <form className="player-form" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="ชื่อสนาม"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="หมายเหตุ เช่น ซอยลาดพร้าว 15 (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
            เพิ่มสนาม
          </button>
        </form>
      )}

      <MasterError message={formError || error} />

      {items.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="ค้นหาสนาม..."
          count={`${shown.length}/${items.length}`}
        />
      )}

      {loading ? (
        <SkeletonList count={5} lines={1} />
      ) : items.length === 0 ? (
        <p className="empty-text">ยังไม่มีสนาม</p>
      ) : shown.length === 0 ? (
        <p className="empty-text">ไม่พบสนามที่ค้นหา</p>
      ) : (
        <ul className="master-list">
          {shown.map((v) => (
            <li key={v.id} className="master-row">
              <div className="master-row-main">
                <EditableName
                  readOnly={!canEdit}
                  label="ชื่อสนาม"
                  fields={[
                    { key: 'name', value: v.name, placeholder: 'ชื่อสนาม', required: true },
                    { key: 'note', value: v.note, placeholder: 'หมายเหตุ' },
                  ]}
                  onSave={(values) => update(v.id, values)}
                >
                  <span className="master-name">{v.name}</span>
                  {v.note && <span className="master-note">{v.note}</span>}
                </EditableName>
              </div>
              <div className="master-row-actions">
                {canDelete && (
                  <AsyncButton
                    className="btn-ghost btn-danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `ลบสนาม "${v.name}"?`,
                        message: 'วันเล่นเก่ายังจำชื่อสนามไว้ ไม่กระทบประวัติ',
                        confirmLabel: 'ลบสนาม',
                        danger: true,
                      })
                      if (ok) remove(v.id)
                    }}
                  >
                    ลบ
                  </AsyncButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ---------------- ยี่ห้อลูกแบด ---------------- */

function ShuttlesTab({ userId, canEdit, canDelete }) {
  const { items, loading, error, add, update, remove } = useMasterList('shuttle_brands', userId)
  const models = useShuttleModels(items.map((b) => b.id))
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  // ค้นเจอทั้งจากชื่อยี่ห้อและชื่อรุ่นที่อยู่ข้างใน — พิมพ์ "Classic" ต้องเจอ RSL
  const shown = filterByQuery(items, query, (b) =>
    models.byBrand(b.id).map((m) => `${m.name} ${m.note ?? ''}`).join(' '),
  )

  async function handleAdd(e) {
    e.preventDefault()
    setFormError('')
    setBusy(true)
    try {
      await add({ name: name.trim(), note: note.trim() || null })
      setName('')
      setNote('')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="panel-hint">
        ใส่ยี่ห้อก่อน แล้วค่อยเพิ่มรุ่นเข้าไปใต้ยี่ห้อนั้น — เปลี่ยนชื่อยี่ห้อทีเดียวมีผลกับทุกรุ่น
        <br />
        ตั้งใจไม่เก็บราคาไว้ตรงนี้ เพราะราคาลูกเปลี่ยนบ่อย จึงกรอกที่วันเล่นแต่ละวันแทน
        ยอดของวันที่จ่ายกันไปแล้วจะได้ไม่ขยับตามราคาใหม่
      </p>

      {canEdit && (
        <form className="player-form" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="ยี่ห้อ เช่น RSL"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="หมายเหตุ (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
            เพิ่มยี่ห้อ
          </button>
        </form>
      )}

      <MasterError message={formError || error || models.error} />

      {items.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="ค้นหายี่ห้อหรือรุ่น..."
          count={`${shown.length}/${items.length}`}
        />
      )}

      {loading ? (
        <SkeletonList count={5} lines={1} />
      ) : items.length === 0 ? (
        <p className="empty-text">ยังไม่มียี่ห้อลูกแบด</p>
      ) : shown.length === 0 ? (
        <p className="empty-text">ไม่พบยี่ห้อหรือรุ่นที่ค้นหา</p>
      ) : (
        <ul className="master-list">
          {shown.map((b) => (
            <BrandRow
              key={b.id}
              brand={b}
              models={models.byBrand(b.id)}
              onUpdateBrand={(values) => update(b.id, values)}
              onRemoveBrand={() => remove(b.id)}
              onAddModel={(values) => models.addModel(b.id, values)}
              onUpdateModel={models.updateModel}
              onRemoveModel={models.removeModel}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function BrandRow({
  brand,
  models,
  onUpdateBrand,
  onRemoveBrand,
  onAddModel,
  onUpdateModel,
  onRemoveModel,
  canEdit,
  canDelete,
}) {
  const confirm = useConfirm()
  const [modelName, setModelName] = useState('')
  const [modelNote, setModelNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleAddModel(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onAddModel({ name: modelName.trim(), note: modelNote.trim() || null })
      setModelName('')
      setModelNote('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="brand-card">
      <div className="brand-head">
        <div className="master-row-main">
          <EditableName
                  readOnly={!canEdit}
            label="ยี่ห้อ"
            fields={[
              { key: 'name', value: brand.name, placeholder: 'ยี่ห้อ', required: true },
              { key: 'note', value: brand.note, placeholder: 'หมายเหตุ' },
            ]}
            onSave={onUpdateBrand}
          >
            <span className="master-name">{brand.name}</span>
            <span className="master-row-meta mono">{models.length} รุ่น</span>
            {brand.note && <span className="master-note">{brand.note}</span>}
          </EditableName>
        </div>
        {canDelete && (
        <AsyncButton
          className="btn-ghost btn-danger"
          onClick={async () => {
            const ok = await confirm({
              title: `ลบยี่ห้อ "${brand.name}"?`,
              message:
                models.length > 0
                  ? `รุ่นทั้ง ${models.length} รุ่นที่อยู่ข้างในจะหายไปด้วย — วันเล่นเก่ายังจำชื่อไว้`
                  : 'วันเล่นเก่ายังจำชื่อไว้ ไม่กระทบประวัติ',
              confirmLabel: 'ลบยี่ห้อ',
              danger: true,
            })
            if (ok) onRemoveBrand()
          }}
        >
          ลบยี่ห้อ
        </AsyncButton>
        )}
      </div>

      {models.length > 0 && (
        <ul className="model-list">
          {models.map((m) => (
            <li key={m.id} className="model-row">
              <div className="master-row-main">
                <EditableName
                  readOnly={!canEdit}
                  label="รุ่น"
                  fields={[
                    { key: 'name', value: m.name, placeholder: 'รุ่น', required: true },
                    { key: 'note', value: m.note, placeholder: 'หมายเหตุ' },
                  ]}
                  onSave={(values) => onUpdateModel(m.id, values)}
                >
                  <span className="model-chip">{m.name}</span>
                  {m.note && <span className="master-note">{m.note}</span>}
                </EditableName>
              </div>
              {canDelete && (
                <AsyncButton
                  className="btn-ghost btn-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `ลบรุ่น "${m.name}"?`,
                      message: `ยี่ห้อ ${brand.name} ยังอยู่ ลบเฉพาะรุ่นนี้`,
                      confirmLabel: 'ลบรุ่น',
                      danger: true,
                    })
                    if (ok) onRemoveModel(m.id)
                  }}
                >
                  ลบ
                </AsyncButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form className="player-form model-form" onSubmit={handleAddModel}>
          <input
            type="text"
            placeholder={`เพิ่มรุ่นของ ${brand.name} เช่น Classic`}
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="หมายเหตุ เช่น ลูกเร็ว 77 (ไม่บังคับ)"
            value={modelNote}
            onChange={(e) => setModelNote(e.target.value)}
          />
          <button className="btn-ghost" type="submit" disabled={busy || !modelName.trim()}>
            + เพิ่มรุ่น
          </button>
        </form>
      )}

      <MasterError message={error} />
    </li>
  )
}

function MasterError({ message }) {
  if (!message) return null
  return <p className="auth-error" style={{ margin: '12px 0 0' }}>{message}</p>
}

/** กรองลิสต์ด้วยคำค้น มองทั้งชื่อและหมายเหตุ (และรุ่น ถ้าส่งมา) */
function filterByQuery(items, query, extra = () => '') {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => `${i.name} ${i.note ?? ''} ${extra(i)}`.toLowerCase().includes(q))
}
