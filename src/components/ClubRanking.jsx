import { useClubRanking } from '../hooks/useClubRanking'
import { MIN_RANKED_GAMES, scoredGames, winRate } from '../utils/ranking'
import { SkeletonList } from './Skeleton'

/**
 * อันดับรวมของก๊วน เรียงตาม rating — ตารางเพราะคนมาดูเพื่อเทียบกัน
 * คนที่เล่นไม่ถึงเกณฑ์ยังไม่มีอันดับ แสดงต่อท้ายแบบจาง ๆ
 *
 * showRating = false: ซ่อนตัวเลข rating แต่ยังเรียงตามมัน (เจ้าของก๊วนเลือกได้
 * ในแท็บตั้งค่า เผื่อบางก๊วนไม่อยากให้ใครเห็นว่าตัวเองได้คะแนนต่ำ)
 */
export default function ClubRanking({ clubId, showRating = true }) {
  const { rows, loading, error } = useClubRanking(clubId)

  if (loading) return <SkeletonList count={5} lines={1} />
  if (error) return <p className="auth-error">{error}</p>
  if (rows.length === 0) {
    return (
      <p className="empty-text">
        ยังไม่มีเกมที่จดแต้ม — ใส่แต้มตอนกด &ldquo;จบเกม&rdquo; แล้วอันดับจะขึ้นที่นี่
      </p>
    )
  }

  let rank = 0
  return (
    <>
      <p className="panel-hint">
        เรียงตามความเก่งที่ระบบเรียนรู้จากแต้มจริง ชนะขาดได้มาก ชนะสูสีได้น้อย
        และแพ้ทีมที่เก่งกว่าแบบสูสีก็ยังได้ · นับเฉพาะเกมที่จดแต้ม เฉพาะคนในรายชื่อ ·
        เล่นครบ {MIN_RANKED_GAMES} เกมก่อนถึงจะมีอันดับ
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="is-num">#</th>
              <th>ชื่อ</th>
              {showRating && <th className="is-num">rating</th>}
              <th className="is-num">เกม</th>
              <th className="is-num">ชนะ</th>
              <th className="is-num">แพ้</th>
              <th className="is-num">% ชนะ</th>
              <th className="is-num">แต้ม +/-</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ranked = scoredGames(r) >= MIN_RANKED_GAMES
              if (ranked) rank++
              return (
                <tr key={r.id} className={ranked ? '' : 'is-cancelled'}>
                  <td className="is-num mono">{ranked ? rank : '—'}</td>
                  <td>{r.name}</td>
                  {showRating && <td className="is-num mono">{Math.round(r.rating)}</td>}
                  <td className="is-num mono">{scoredGames(r)}</td>
                  <td className="is-num mono">{r.wins}</td>
                  <td className="is-num mono">{r.losses}</td>
                  <td className="is-num mono">{Math.round(winRate(r) * 100)}%</td>
                  <td className="is-num mono">
                    {r.pointDiff > 0 ? '+' : ''}
                    {r.pointDiff}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
