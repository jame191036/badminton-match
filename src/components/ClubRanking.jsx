import { useClubRanking } from '../hooks/useClubRanking'
import { MIN_RANKED_GAMES, scoredGames, winRate } from '../utils/ranking'
import { SkeletonList } from './Skeleton'

/**
 * อันดับรวมของก๊วน — ตารางเพราะคนมาดูเพื่อเทียบกัน (แบบเดียวกับประวัติวันเล่น)
 * คนที่เล่นไม่ถึงเกณฑ์ยังไม่มีอันดับ แสดงต่อท้ายแบบจาง ๆ
 */
export default function ClubRanking({ clubId }) {
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
        นับเฉพาะเกมที่จดแต้ม และเฉพาะคนในรายชื่อ (แขกขาจรไม่ติดอันดับ) ·
        เล่นครบ {MIN_RANKED_GAMES} เกมก่อนถึงจะมีอันดับ
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="is-num">#</th>
              <th>ชื่อ</th>
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
