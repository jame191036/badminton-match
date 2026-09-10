import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { pairKey, pickNextMatch } from '../utils/pairing'

// map แถวจาก DB (snake_case) ให้เป็น shape เดิมที่ components ใช้อยู่ (camelCase)
function mapPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    skill: row.skill,
    status: row.status,
    gamesPlayed: row.games_played,
    paying: row.paying,
    queuedAt: row.queue_seq,
  }
}

export function useBadmintonData(sessionId, queueMode = 'sequential') {
  const [players, setPlayers] = useState([])
  const [courts, setCourts] = useState([])
  const [history, setHistory] = useState([])
  const [summary, setSummary] = useState(null)
  // Map: pairKey(a,b) -> { together, against } ใช้โดยโหมดคิว 'rotate'
  const [pairStats, setPairStats] = useState(() => new Map())
  const [loading, setLoading] = useState(true)

  const refetchAll = useCallback(async () => {
    if (!sessionId) return

    const [
      playersRes,
      courtsRes,
      activeMatchesRes,
      historyRes,
      statsRes,
      summaryRes,
      pairsRes,
    ] = await Promise.all([
      supabase.from('players').select('*').eq('session_id', sessionId).order('queue_seq'),
      supabase.from('courts').select('*').eq('session_id', sessionId).order('sort_order'),
      supabase
        .from('matches')
        .select('id, court_id, status, started_at, match_players(player_id, player_name, skill, team)')
        .eq('session_id', sessionId)
        .is('ended_at', null),
      supabase.from('v_match_history').select('*').eq('session_id', sessionId).limit(30),
      supabase.from('v_session_player_stats').select('player_id, games, minutes').eq('session_id', sessionId),
      supabase.from('v_session_summary').select('*').eq('session_id', sessionId).single(),
      supabase.from('v_pair_history').select('*').eq('session_id', sessionId),
    ])

    setPairStats(
      new Map(
        (pairsRes.data ?? []).map((r) => [
          pairKey(r.player_a, r.player_b),
          { together: r.together_count, against: r.against_count },
        ])
      )
    )

    if (playersRes.data) {
      // เวลาที่เล่นจริงคิดจาก started_at/ended_at ของแมตช์ ผ่าน view
      // (games_played บน players ยังเป็นตัวหลักที่ใช้เรียงคิว)
      const statsById = new Map(
        (statsRes.data ?? []).map((s) => [s.player_id, s])
      )
      setPlayers(
        playersRes.data.map((row) => ({
          ...mapPlayer(row),
          minutesPlayed: Math.round(Number(statsById.get(row.id)?.minutes ?? 0)),
        }))
      )
    }

    if (summaryRes.data) {
      setSummary({
        playerCount: summaryRes.data.player_count,
        courtCount: summaryRes.data.court_count,
        bookedHours: Number(summaryRes.data.booked_hours),
        finishedGames: summaryRes.data.finished_games,
        totalPlayMinutes: Math.round(Number(summaryRes.data.total_play_minutes)),
      })
    }

    if (courtsRes.data) {
      const matchByCourtId = new Map((activeMatchesRes.data ?? []).map((m) => [m.court_id, m]))
      setCourts(
        courtsRes.data.map((c) => {
          const m = matchByCourtId.get(c.id)
          const base = { id: c.id, name: c.name, hours: c.hours ?? 0 }
          if (!m) return { ...base, match: null }
          const teamA = m.match_players
            .filter((mp) => mp.team === 'A')
            .map((mp) => ({ id: mp.player_id, name: mp.player_name, skill: mp.skill }))
          const teamB = m.match_players
            .filter((mp) => mp.team === 'B')
            .map((mp) => ({ id: mp.player_id, name: mp.player_name, skill: mp.skill }))
          return {
            ...base,
            match: {
              id: m.id,
              status: m.status,
              startedAt: m.started_at ? new Date(m.started_at).getTime() : null,
              teamA,
              teamB,
            },
          }
        })
      )
    }

    if (historyRes.data) {
      setHistory(
        historyRes.data.map((h) => ({
          id: h.id,
          time: new Date(h.ended_at).toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          courtName: h.court_name,
          teamA: h.team_a_names ?? [],
          teamB: h.team_b_names ?? [],
        }))
      )
    }

    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    refetchAll()
  }, [refetchAll])

  // realtime: มีอะไรเปลี่ยนในตารางที่เกี่ยวข้อง -> refetch ทั้งชุดใหม่
  // (ง่ายและชัวร์ที่สุดสำหรับแอปขนาดนี้ ไม่ต้อง diff state เอง)
  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        refetchAll
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courts', filter: `session_id=eq.${sessionId}` },
        refetchAll
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `session_id=eq.${sessionId}` },
        refetchAll
      )
      // match_players ไม่มีคอลัมน์ session_id ตรงๆ เลยฟังทุกแถวแล้วปล่อยให้ refetchAll กรองเอง
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, refetchAll)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [sessionId, refetchAll])

  // ---------- actions ----------

  // ผ่าน RPC เพราะต้องสร้าง/อัปเดตแถวใน members ไปพร้อมกันใน transaction เดียว
  // (รายชื่อสมาชิกจึงสะสมขึ้นมาเองโดยไม่ต้องมีหน้าจัดการแยก)
  const addPlayer = useCallback(
    async (name, skill) => {
      if (!sessionId) return
      const { error } = await supabase.rpc('add_player', {
        p_session_id: sessionId,
        p_name: name,
        p_skill: skill,
      })
      if (error) console.error(error)
    },
    [sessionId]
  )

  const removePlayer = useCallback(async (id) => {
    const { error } = await supabase.from('players').delete().eq('id', id)
    if (error) console.error(error)
  }, [])

  const togglePaying = useCallback(
    async (id) => {
      const player = players.find((p) => p.id === id)
      if (!player) return
      const { error } = await supabase.from('players').update({ paying: !player.paying }).eq('id', id)
      if (error) console.error(error)
    },
    [players]
  )

  const toggleRest = useCallback(
    async (id) => {
      const player = players.find((p) => p.id === id)
      if (!player) return
      if (player.status === 'resting') {
        const { error } = await supabase.rpc('resume_player_queue', { p_player_id: id })
        if (error) console.error(error)
      } else {
        const { error } = await supabase.from('players').update({ status: 'resting' }).eq('id', id)
        if (error) console.error(error)
      }
    },
    [players]
  )

  const addCourt = useCallback(async () => {
    if (!sessionId) return
    const { error } = await supabase
      .from('courts')
      .insert({ session_id: sessionId, name: `คอร์ต ${courts.length + 1}`, sort_order: courts.length })
    if (error) console.error(error)
  }, [sessionId, courts.length])

  // ชั่วโมงที่จองของแต่ละคอร์ต — ใช้คิดค่าสนาม (ดู BillingPanel)
  const updateCourtHours = useCallback(async (courtId, hours) => {
    const { error } = await supabase.from('courts').update({ hours }).eq('id', courtId)
    if (error) console.error(error)
  }, [])

  const removeCourt = useCallback(async () => {
    const last = courts[courts.length - 1]
    if (!last) return
    const { error } = await supabase.rpc('remove_court', { p_court_id: last.id })
    if (error) console.error(error)
  }, [courts])

  const assignCourt = useCallback(
    async (courtId) => {
      const waiting = players.filter((p) => p.status === 'waiting')
      const match = pickNextMatch(waiting, { mode: queueMode, pairStats })
      if (!match) return
      const { error } = await supabase.rpc('assign_court', {
        p_court_id: courtId,
        p_team_a: match.teamA.map((p) => p.id),
        p_team_b: match.teamB.map((p) => p.id),
      })
      if (error) console.error(error)
    },
    [players, queueMode, pairStats]
  )

  // pending -> playing (เริ่มจับเวลา)
  const startMatch = useCallback(
    async (courtId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      const { error } = await supabase.rpc('start_match', { p_match_id: court.match.id })
      if (error) console.error(error)
    },
    [courts]
  )

  // เอาคนที่ยังไม่พร้อมออกไปพัก แล้วดึงคนแรกในคิวมาแทน (ทำได้เฉพาะตอน pending)
  const substitutePlayer = useCallback(
    async (courtId, playerId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      const { error } = await supabase.rpc('substitute_player', {
        p_match_id: court.match.id,
        p_player_id: playerId,
      })
      if (error) console.error(error)
    },
    [courts]
  )

  const cancelMatch = useCallback(
    async (courtId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      const { error } = await supabase.rpc('cancel_match', { p_match_id: court.match.id })
      if (error) console.error(error)
    },
    [courts]
  )

  const finishMatch = useCallback(
    async (courtId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      const { error } = await supabase.rpc('finish_match', { p_match_id: court.match.id })
      if (error) console.error(error)
    },
    [courts]
  )

  return {
    players,
    courts,
    history,
    summary,
    loading,
    addPlayer,
    removePlayer,
    togglePaying,
    toggleRest,
    addCourt,
    removeCourt,
    updateCourtHours,
    assignCourt,
    startMatch,
    substitutePlayer,
    cancelMatch,
    finishMatch,
  }
}
