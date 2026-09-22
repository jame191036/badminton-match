import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmContext } from '../hooks/useConfirm'
import { Info, TriangleAlert } from 'lucide-react'

/**
 * กล่องยืนยันแบบ promise — ใช้แทน window.confirm() ได้ตรงๆ
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'ลบ?', danger: true })) remove(id)
 *
 * ใช้ <dialog> ของเบราว์เซอร์ ไม่ใช่ div ครอบเอง เพราะได้ของพวกนี้มาฟรี
 * และทำเองให้ถูกยาก: ล็อกโฟกัสไว้ในกล่อง, ปิดด้วย Esc, อยู่บนสุดเสมอ
 * (top layer ไม่ต้องไล่แก้ z-index) และ screen reader รู้ว่าเป็น modal
 */
export function ConfirmProvider({ children }) {
  // { options, resolve } — null = ไม่มีกล่องเปิดอยู่
  const [pending, setPending] = useState(null)
  const [typed, setTyped] = useState('')
  const dialogRef = useRef(null)

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setTyped('')
        setPending({ options, resolve })
      }),
    [],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (pending) dialog.showModal()
    else if (dialog.open) dialog.close()
  }, [pending])

  const settle = useCallback(
    (result) => {
      pending?.resolve(result)
      setPending(null)
    },
    [pending],
  )

  const o = pending?.options ?? {}
  const needsText = Boolean(o.requireText)
  const canConfirm = !needsText || typed.trim() === o.requireText

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <dialog
        ref={dialogRef}
        className="confirm-dialog"
        // Esc หรือคลิกนอกกล่อง = ยกเลิก ต้อง resolve(false) ไม่งั้น promise ค้าง
        onCancel={(e) => {
          e.preventDefault()
          settle(false)
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) settle(false)
        }}
      >
        {pending && (
          <div className="confirm-body">
            <div className={`confirm-icon${o.danger ? ' is-danger' : ''}`} aria-hidden="true">
              {o.danger ? (
                <TriangleAlert strokeWidth={1.8} />
              ) : (
                <Info strokeWidth={1.8} />
              )}
            </div>

            <h2>{o.title}</h2>
            {o.message && <p className="confirm-message">{o.message}</p>}

            {needsText && (
              <label className="field confirm-field">
                <span className="field-label">
                  พิมพ์ &ldquo;{o.requireText}&rdquo; เพื่อยืนยัน
                </span>
                <input
                  type="text"
                  value={typed}
                  autoFocus
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canConfirm) {
                      e.preventDefault()
                      settle(true)
                    }
                  }}
                />
              </label>
            )}

            <div className="confirm-actions">
              <button className="btn-ghost" type="button" onClick={() => settle(false)}>
                {o.cancelLabel ?? 'ยกเลิก'}
              </button>
              <button
                className={`btn-primary${o.danger ? ' btn-destructive' : ''}`}
                type="button"
                disabled={!canConfirm}
                autoFocus={!needsText}
                onClick={() => settle(true)}
              >
                {o.confirmLabel ?? 'ยืนยัน'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  )
}
