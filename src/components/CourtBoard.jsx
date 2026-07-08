import { skillLabel } from '../utils/pairing'

function TeamSide({ team, label }) {
  return (
    <div className="team-side">
      <span className="team-label mono">{label}</span>
      {team.map((p) => (
        <div key={p.id} className="team-player">
          <span>{p.name}</span>
          <span className="team-skill mono">{skillLabel(p.skill)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CourtBoard({ courts, waitingCount, onAssign, onFinish, onAddCourt, onRemoveCourt }) {
  return (
    <div className="court-board">
      <div className="court-board-head">
        <h3>คอร์ต</h3>
        <div className="court-controls">
          <button className="btn-ghost" onClick={onRemoveCourt} disabled={courts.length <= 1}>− คอร์ต</button>
          <span className="mono">{courts.length} คอร์ต</span>
          <button className="btn-ghost" onClick={onAddCourt}>+ คอร์ต</button>
        </div>
      </div>

      <div className="court-grid">
        {courts.map((court) => (
          <div key={court.id} className={`court-card ${court.match ? 'occupied' : 'empty'}`}>
            <div className="court-name display">{court.name}</div>
            {court.match ? (
              <>
                <div className="court-match">
                  <TeamSide team={court.match.teamA} label="ฝั่ง A" />
                  <div className="vs mono">VS</div>
                  <TeamSide team={court.match.teamB} label="ฝั่ง B" />
                </div>
                <button className="btn-primary btn-finish" onClick={() => onFinish(court.id)}>จบเกม → คืนคิว</button>
              </>
            ) : (
              <>
                <p className="court-empty-msg">คอร์ตว่าง</p>
                <button
                  className="btn-primary"
                  onClick={() => onAssign(court.id)}
                  disabled={waitingCount < 4}
                  title={waitingCount < 4 ? 'ต้องมีผู้เล่นรอคิวอย่างน้อย 4 คน' : ''}
                >
                  จับคู่ลงคอร์ต
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
