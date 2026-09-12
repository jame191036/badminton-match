import { useEffect, useState } from 'react'
import { CalendarDays, MapPin, Users, Feather } from 'lucide-react'
import { useMembers } from '../hooks/useMembers'
import { useMasterList } from '../hooks/useMasterList'
import { useShuttleModels } from '../hooks/useShuttleModels'
import SearchSelect from './SearchSelect'
import SearchBox from './SearchBox'
import DatePicker from './DatePicker'
import { QUEUE_MODES, SKILL_LEVELS } from '../utils/pairing'
import { addDays, addHours, hoursBetween, todayISO } from '../utils/date'

// เวลาเริ่มที่ก๊วนแบดใช้กันจริง ๆ และความยาวที่จองกันบ่อย
const START_PRESETS = ['17:00', '18:00', '19:00', '20:00']
const DURATION_PRESETS = [1, 2, 3]

function shortThaiDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
  })
}

function shortWeekday(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short' })
}

const BLANK_COURT = { name: '', hours: '' }

// ขนาด/ความหนาเส้นของไอคอนหัวข้อ ให้ตรงกับ SVG ที่เขียนมือไว้ที่อื่นในแอป
const ICON = { size: 19, strokeWidth: 1.8, className: 'form-section-icon', 'aria-hidden': true }

/**
 * ฟอร์มสร้างวันเล่น — หน้าเดียวจบ ไม่ทำเป็น wizard หลายจอ
 * เพราะบางทีนัดกันกะทันหันแล้วต้องรีบเริ่มตี
 *
 * ราคาปล่อยว่างไว้ได้: ราคาจริงมักรู้ตอนจบวัน ถ้าบังคับกรอกตอนสร้าง
 * จะได้ตัวเลขมั่วที่ไม่มีใครกลับมาแก้
 */
export default function NewPlayDayForm({ ownerId, onSubmit, onCancel, loadDefaults }) {
  const { members } = useMembers(ownerId)
  const { items: venues } = useMasterList('venues', ownerId)
  const { items: brands } = useMasterList('shuttle_brands', ownerId)
  const { byBrand } = useShuttleModels(brands.map((b) => b.id))

  // อ่านนาฬิกาครั้งเดียวตอน mount ไม่ใช่ทุก render
  const [today] = useState(todayISO)
  const [playDate, setPlayDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [venueId, setVenueId] = useState('')
  const [courts, setCourts] = useState([{ name: 'คอร์ต 1', hours: '' }])
  const [selected, setSelected] = useState(() => new Set())
  const [brandId, setBrandId] = useState('')
  const [modelId, setModelId] = useState('')
  const [shuttleCount, setShuttleCount] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [shuttlePrice, setShuttlePrice] = useState('')
  const [queueMode, setQueueMode] = useState('sequential')
  const [memberQuery, setMemberQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * กางทุกส่วนไว้ตั้งแต่แรก — ฟอร์มนี้อยู่บนหน้าของตัวเองแล้ว ความยาวไม่ได้
   * ไปแย่งที่กับอะไร และการเห็นค่าที่ลอกมาจริง ๆ ตรวจง่ายกว่าเห็นแค่สรุป
   * ยังพับเก็บได้อยู่ถ้าอยากซ่อนส่วนที่ไม่แตะ
   */
  const [open, setOpen] = useState({ when: true, where: true, who: true, gear: true })
  const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  // prefill จากวันล่าสุดของก๊วนนี้ — เคสปกติคือ "เหมือนเดิมทุกอย่าง" กดยืนยันได้เลย
  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const d = await loadDefaults()
        if (!alive || !d?.found) return
        setVenueId(d.venue_id ?? '')
        setBrandId(d.shuttle_brand_id ?? '')
        setModelId(d.shuttle_model_id ?? '')
        setStartTime(d.start_time ? String(d.start_time).slice(0, 5) : '')
        setEndTime(d.end_time ? String(d.end_time).slice(0, 5) : '')
        setHourlyRate(d.hourly_rate ? String(d.hourly_rate) : '')
        setShuttlePrice(d.shuttle_price ? String(d.shuttle_price) : '')
        setQueueMode(d.queue_mode ?? 'sequential')
        if (Array.isArray(d.courts) && d.courts.length > 0) {
          setCourts(d.courts.map((c) => ({ name: c.name, hours: String(c.hours ?? '') })))
        }
        if (Array.isArray(d.member_ids) && d.member_ids.length > 0) {
          setSelected(new Set(d.member_ids))
        }
      } catch {
        // ไม่มีวันเก่าให้ลอกก็ไม่เป็นไร ใช้ค่าว่างต่อได้
      }
    }

    load()
    return () => {
      alive = false
    }
  }, [loadDefaults])

  const selectedMembers = members.filter((m) => selected.has(m.id))
  const q = memberQuery.trim().toLowerCase()
  const filteredMembers = q
    ? members.filter((m) => `${m.name} ${m.note ?? ''}`.toLowerCase().includes(q))
    : members

  function toggleMember(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateCourt(index, key, value) {
    setCourts((prev) => prev.map((c, i) => (i === index ? { ...c, [key]: value } : c)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const cleanCourts = courts
      .map((c, i) => ({
        name: c.name.trim() || `คอร์ต ${i + 1}`,
        hours: Number(c.hours) || 0,
      }))
      .filter((c) => c.name)

    // required บน input ใช้ไม่ได้ถ้าส่วนนั้นถูกพับอยู่ เพราะ FormSection
    // ถอด children ออกจาก DOM ไปเลย เบราว์เซอร์จึงไม่เห็นช่องที่ต้องตรวจ
    if (!playDate) {
      setError('ต้องเลือกวันที่')
      setOpen((prev) => ({ ...prev, when: true }))
      return
    }

    if (cleanCourts.length === 0) {
      setError('ต้องมีอย่างน้อยหนึ่งคอร์ต')
      // กางส่วนที่ผิดให้เอง ไม่งั้นจะเห็นข้อความ error แต่หาช่องที่ต้องแก้ไม่เจอ
      setOpen((prev) => ({ ...prev, where: true }))
      return
    }

    setBusy(true)
    try {
      await onSubmit({
        playDate,
        startTime,
        endTime,
        venueId: venueId || null,
        shuttleBrandId: brandId || null,
        shuttleModelId: modelId || null,
        hourlyRate: hourlyRate === '' ? null : Number(hourlyRate),
        shuttlePrice: shuttlePrice === '' ? null : Number(shuttlePrice),
        shuttleCount: shuttleCount === '' ? 0 : Number(shuttleCount),
        queueMode,
        memberIds: [...selected],
        courts: cleanCourts,
      })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // ---- สรุปบรรทัดเดียวของแต่ละส่วน ใช้ตอนพับอยู่ ----
  const dateLabel = playDate
    ? new Date(`${playDate}T00:00:00`).toLocaleDateString('th-TH', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : 'ยังไม่เลือกวัน'
  const timeLabel = [startTime, endTime].filter(Boolean).join('–')

  // ปุ่มลัดเลือกวัน — หนึ่งสัปดาห์เต็มนับจากวันนี้ เรียงตามวันจริง ไม่ใช่เรียงตามชื่อวัน
  // (ถ้าเรียง จ-อา ตายตัว วันที่บนปุ่มจะกระโดดไปมาจนอ่านยาก)
  const weekChips = Array.from({ length: 7 }, (_, i) => {
    const value = addDays(today, i)
    // ต่อวันที่ท้ายชื่อวัน ไม่งั้นไม่รู้ว่า "ส." คือเสาร์ไหน
    return { label: shortWeekday(value), value, sub: shortThaiDate(value) }
  })

  const duration = hoursBetween(startTime, endTime)

  function pickStart(time) {
    setStartTime(time)
    // รักษาความยาวเดิมไว้ ถ้ายังไม่เคยใส่เวลาจบก็ให้ 3 ชม. เป็นค่าเริ่ม
    //
    // ต้องเช็คช่วง ไม่ใช่แค่ว่ามีค่าไหม เพราะ hoursBetween วนรอบ 24 ชม.
    // เวลาจบก่อนเวลาเริ่ม (พิมพ์ผิด) จะออกมาเป็น ~22 ชม. ส่วนเวลาเท่ากันได้ 0
    // ทั้งสองแบบเอามาคูณต่อไม่ได้ ให้ตกกลับไปใช้ 3 ชม. แทน
    const keep = duration && duration > 0 && duration <= 8 ? duration : 3
    setEndTime(addHours(time, keep))
  }

  function pickDuration(hours) {
    const start = startTime || '19:00'
    setStartTime(start)
    setEndTime(addHours(start, hours))
  }

  const totalHours = courts.reduce((s, c) => s + (Number(c.hours) || 0), 0)
  const venueName = venues.find((v) => v.id === venueId)?.name
  const whereSummary = [
    venueName ?? 'ยังไม่ระบุสนาม',
    `${courts.length} คอร์ต`,
    totalHours > 0 ? `รวม ${totalHours} ชม.` : 'ยังไม่ใส่ชั่วโมง',
  ].join(' · ')

  const gearSummary = [
    [brands.find((b) => b.id === brandId)?.name, byBrand(brandId).find((m) => m.id === modelId)?.name]
      .filter(Boolean)
      .join(' ') || 'ยังไม่ระบุลูกแบด',
    Number(hourlyRate) ? `${Number(hourlyRate).toLocaleString('th-TH')} บาท/ชม.` : 'ยังไม่ใส่ค่าสนาม',
    Number(shuttlePrice) ? `ลูกละ ${Number(shuttlePrice).toLocaleString('th-TH')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <form className="day-form" onSubmit={handleSubmit}>
      <FormSection
        icon={<CalendarDays {...ICON} />}
        title="วันและเวลา"
        summary={[dateLabel, timeLabel].filter(Boolean).join(' · ')}
        open={open.when}
        onToggle={() => toggle('when')}
      >
        <div className="quick-picks">
          {weekChips.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`quick-chip${playDate === c.value ? ' is-on' : ''}`}
              onClick={() => setPlayDate(c.value)}
            >
              {c.label}
              <span className="quick-chip-sub">{c.sub}</span>
            </button>
          ))}
        </div>

        <div className="quick-picks">
          <span className="quick-picks-label">เริ่ม</span>
          {START_PRESETS.map((t) => (
            <button
              key={t}
              type="button"
              className={`quick-chip${startTime === t ? ' is-on' : ''}`}
              onClick={() => pickStart(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="quick-picks">
          <span className="quick-picks-label">เล่น</span>
          {DURATION_PRESETS.map((h) => (
            <button
              key={h}
              type="button"
              className={`quick-chip${duration === h ? ' is-on' : ''}`}
              onClick={() => pickDuration(h)}
            >
              {h} ชม.
            </button>
          ))}
        </div>

        {/* ช่องกรอกจริงอยู่ล่างสุด — ปุ่มลัดครอบคลุมเกือบทุกเคสแล้ว
            ตรงนี้ไว้ใช้ตอนอยากได้วันหรือเวลาที่ไม่มีในปุ่ม */}
        <div className="form-grid">
          <div className="field">
            <span className="field-label">วันที่</span>
            <DatePicker value={playDate} onChange={setPlayDate} />
          </div>
          <label className="field">
            <span className="field-label">เริ่ม</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">ถึง</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
      </FormSection>

      <FormSection
        icon={<MapPin {...ICON} />}
        title="สนามและคอร์ต"
        summary={whereSummary}
        open={open.where}
        onToggle={() => toggle('where')}
      >
        <div className="field">
          <span className="field-label">สนาม</span>
          <SearchSelect
            value={venueId}
            onChange={setVenueId}
            placeholder="— ไม่ระบุ —"
            options={venues.map((v) => ({ value: v.id, label: v.name, hint: v.note }))}
          />
        </div>

        <fieldset className="field-group">
          <legend className="field-label">คอร์ตที่จอง</legend>
          <p className="panel-hint">หนึ่งแถว = หนึ่งคอร์ต ชั่วโมงของแต่ละคอร์ตคือตัวคูณค่าสนาม</p>
        {courts.map((court, i) => (
          <div className="court-row" key={i}>
            <input
              type="text"
              placeholder={`คอร์ต ${i + 1}`}
              value={court.name}
              onChange={(e) => updateCourt(i, 'name', e.target.value)}
            />
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="ชม."
              value={court.hours}
              onChange={(e) => updateCourt(i, 'hours', e.target.value)}
              className="inline-number"
            />
            <button
              type="button"
              className="btn-ghost btn-danger"
              onClick={() => setCourts((prev) => prev.filter((_, idx) => idx !== i))}
              disabled={courts.length === 1}
            >
              ลบ
            </button>
          </div>
        ))}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCourts((prev) => [...prev, { ...BLANK_COURT }])}
          >
            + เพิ่มคอร์ต
          </button>
        </fieldset>
      </FormSection>

      <FormSection
        icon={<Users {...ICON} />}
        title="ผู้เล่น"
        // ป้ายนี้เห็นตลอดทั้งตอนพับและตอนกาง ต่างจาก summary ที่โผล่เฉพาะตอนพับ
        // — จำนวนคนที่เลือกต้องเห็นได้ "ระหว่าง" กำลังเลือกด้วย ไม่งั้นไม่รู้ว่าครบยัง
        // (ตัวเลขในช่องค้นหาเป็นจำนวนที่ค้นเจอ ไม่ใช่จำนวนที่เลือก)
        badge={selected.size > 0 ? `${selected.size} คน` : null}
        summary={selected.size > 0 ? `${selected.size} คน` : 'ยังไม่ได้เลือกใคร'}
        open={open.who}
        onToggle={() => toggle('who')}
      >
        <p className="panel-hint">
          เลือกไว้ก่อนได้ ใครไม่มาค่อยกด &ldquo;ไม่มา&rdquo; หน้างาน และเพิ่มแขกเพิ่มได้ตลอด
        </p>
        {members.length === 0 ? (
          <p className="empty-text">ยังไม่มีรายชื่อ — ไปเพิ่มที่หน้าข้อมูลหลักก่อน</p>
        ) : (
          <>
            {/* คนที่เลือกแล้วโชว์แยกไว้ข้างบนเสมอ ไม่งั้นพอพิมพ์ค้นหา
                คนที่เลือกไว้แต่ไม่ตรงคำค้นจะหายไปจนนึกว่าหลุดไปแล้ว */}
            {selectedMembers.length > 0 && (
              <div className="member-picker is-selected">
                {selectedMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="member-chip is-on"
                    onClick={() => toggleMember(m.id)}
                    title="เอาออก"
                  >
                    <span>{m.name}</span>
                    <span className="member-chip-x" aria-hidden="true">
                      ×
                    </span>
                  </button>
                ))}
              </div>
            )}

            <SearchBox
              value={memberQuery}
              onChange={setMemberQuery}
              placeholder="ค้นหาชื่อผู้เล่น..."
              count={`${filteredMembers.length} คน`}
            />

            {filteredMembers.length === 0 ? (
              <p className="empty-text">ไม่พบชื่อที่ค้นหา</p>
            ) : (
              <div className="member-picker">
                {filteredMembers.map((m) => (
                  <label key={m.id} className={`member-chip${selected.has(m.id) ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggleMember(m.id)}
                    />
                    <span>{m.name}</span>
                    <span className={`skill-chip skill-${m.skill}`}>
                      {SKILL_LEVELS.find((s) => s.value === m.skill)?.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </FormSection>

      <FormSection
        icon={<Feather {...ICON} />}
        title="ลูกแบดและราคา"
        summary={gearSummary}
        open={open.gear}
        onToggle={() => toggle('gear')}
      >
      <div className="form-grid">
        <div className="field">
          <span className="field-label">ยี่ห้อลูกแบด</span>
          <SearchSelect
            value={brandId}
            placeholder="— ไม่ระบุ —"
            options={brands.map((b) => ({ value: b.id, label: b.name, hint: b.note }))}
            onChange={(next) => {
              setBrandId(next)
              setModelId('') // รุ่นของยี่ห้อเดิมใช้กับยี่ห้อใหม่ไม่ได้ DB จะปฏิเสธ
            }}
          />
        </div>
        <div className="field">
          <span className="field-label">รุ่น</span>
          <SearchSelect
            value={modelId}
            onChange={setModelId}
            disabled={!brandId || byBrand(brandId).length === 0}
            placeholder={
              !brandId
                ? '— เลือกยี่ห้อก่อน —'
                : byBrand(brandId).length === 0
                  ? '— ยี่ห้อนี้ยังไม่มีรุ่น —'
                  : '— ไม่ระบุ —'
            }
            options={byBrand(brandId).map((m) => ({
              value: m.id,
              label: m.name,
              hint: m.note,
            }))}
          />
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">จำนวนลูกที่ใช้</span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={shuttleCount}
            onChange={(e) => setShuttleCount(e.target.value)}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">ค่าสนาม/ชม.</span>
          <input
            type="number"
            min="0"
            step="10"
            placeholder="กรอกทีหลังได้"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">ราคาลูก/ลูก</span>
          <input
            type="number"
            min="0"
            step="5"
            placeholder="กรอกทีหลังได้"
            value={shuttlePrice}
            onChange={(e) => setShuttlePrice(e.target.value)}
          />
        </label>
      </div>

        <label className="field">
          <span className="field-label">วิธีจัดคิว</span>
          <select value={queueMode} onChange={(e) => setQueueMode(e.target.value)}>
            {QUEUE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} — {m.hint}
              </option>
            ))}
          </select>
        </label>
      </FormSection>

      {error && <p className="auth-error">{error}</p>}

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'กำลังบันทึก...' : 'สร้างวันเล่น'}
        </button>
        <button className="btn-ghost" type="button" onClick={onCancel}>
          ยกเลิก
        </button>
      </div>
    </form>
  )
}

/**
 * ส่วนของฟอร์มที่พับเก็บได้ ตอนพับจะโชว์สรุปบรรทัดเดียวแทน
 *
 * ไม่ใช้ <details>/<summary> ของ HTML เพราะต้องคุมสถานะเปิด-ปิดจากข้างนอกด้วย
 * (พับทั้งหมดตอนลอกค่ามาได้ และกางส่วนที่กรอกผิดตอนกดส่ง)
 */
function FormSection({ icon, title, summary, badge, open, onToggle, children }) {
  return (
    <div className={`form-section${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="form-section-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        {icon}
        <span className="form-section-title">{title}</span>
        {badge && <span className="tab-count mono">{badge}</span>}
        {!open && <span className="form-section-summary">{summary}</span>}
        <span className="form-section-action">{open ? 'ย่อ' : 'แก้'}</span>
      </button>
      {open && <div className="form-section-body">{children}</div>}
    </div>
  )
}
