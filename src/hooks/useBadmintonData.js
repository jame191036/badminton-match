import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { pairKey, pickNextMatch } from '../utils/pairing'

// map แถวจาก DB (snake_case) ให้เป็น shape เดิมที่ components ใช้อยู่ (camelCase)
function mapPlayer(row) {
  return {
    id: row.id,
    // ใช้กรองรายชื่อ master ที่ลงชื่อไปแล้ว ไม่ให้เลือกซ้ำ (null = แขกขาจร)
    memberId: row.member_id,
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
  // ข้อความ error ของคำสั่งล่าสุด (ส่วนใหญ่มาจาก RPC เป็นภาษาไทยอยู่แล้ว)
  const [actionError, setActionError] = useState('')

  // refetchAll ถูกเรียกจาก realtime callback ด้วย ซึ่งอาจมาถึงหลัง unmount
  // (ตั้ง true ตอน mount ไม่ใช่ตอนประกาศ เพราะ StrictMode จะ mount ซ้ำรอบสอง)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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

    if (!mountedRef.current) return

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
        historyRes.data.map((h) => {
          const clock = (v) =>
            v ? new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''

          // เวลาที่ใช้จริงของเกมนั้น คิดจากตอนกด "เริ่มเกม" ถึงตอนกด "จบเกม"
          // (ไม่ใช่ตั้งแต่จับคู่ลงคอร์ต — ช่วง pending ยังไม่ได้ตีกัน)
          const seconds =
            h.started_at && h.ended_at
              ? Math.max(0, (new Date(h.ended_at) - new Date(h.started_at)) / 1000)
              : null

          return {
            id: h.id,
            time: clock(h.ended_at),
            startTime: clock(h.started_at),
            durationSeconds: seconds,
            courtName: h.court_name,
            teamA: h.team_a_names ?? [],
            teamB: h.team_b_names ?? [],
          }
        })
      )
    }

    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    async function load() {
      await refetchAll()
    }
    load()
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

  /**
   * ห่อทุกคำสั่งที่เขียน DB ไว้ที่เดียว เพื่อเก็บ error มาโชว์บนจอ
   *
   * RPC ฝั่ง DB raise ข้อความไทยที่อธิบายสาเหตุมาให้อยู่แล้ว
   * (เช่น "ต้องกดเริ่มวันเล่นก่อนถึงจะจัดคนลงคอร์ตได้") ถ้าปล่อยให้ลง
   * console อย่างเดียว ผู้ใช้จะเห็นแค่ "กดแล้วไม่มีอะไรเกิดขึ้น"
   */
  const run = useCallback(
    async (query) => {
      const { error } = await query
      if (error) {
        console.error(error)
        setActionError(error.message || 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง')
        return false
      }
      setActionError('')

      // โหลดใหม่เองหลังเขียนสำเร็จ ไม่รอ realtime
      //
      // realtime ที่ subscribe แบบมี filter (session_id=eq.…) ส่ง event ลบไม่ถึง
      // เพราะ payload ของ DELETE มีแค่คีย์หลัก ไม่มี session_id ให้ filter จับ
      // กดลบแล้วหน้าจอเลยนิ่งจนกว่าจะ F5
      //
      // และถึง realtime จะทำงานครบ การกระทำของตัวเองก็ควรเห็นผลทันที
      // ไม่ใช่รอ event เดินทางกลับมา — realtime มีไว้ให้ "เครื่องอื่น" รู้
      await refetchAll()
      return true
    },
    [refetchAll],
  )

  const clearActionError = useCallback(() => setActionError(''), [])

  // ผ่าน RPC เพราะต้องสร้าง/อัปเดตแถวใน members ไปพร้อมกันใน transaction เดียว
  // (รายชื่อสมาชิกจึงสะสมขึ้นมาเองโดยไม่ต้องมีหน้าจัดการแยก)
  // saveToMaster = false คือแขกขาจร: เล่นวันนี้วันเดียว ไม่ต้องไปโผล่ในรายชื่อ
  // (member_id เป็น null ได้ ประวัติเลยยังอยู่ครบแม้ไม่มีสมาชิกผูกไว้)
  const addPlayer = useCallback(
    async (name, skill, saveToMaster = true) => {
      if (!sessionId) return
      await run(
        supabase.rpc('add_player', {
          p_session_id: sessionId,
          p_name: name,
          p_skill: skill,
          p_save_to_master: saveToMaster,
        }),
      )
    },
    [sessionId, run]
  )

  const removePlayer = useCallback(
    async (id) => {
      await run(supabase.from('players').delete().eq('id', id))
    },
    [run]
  )

  const togglePaying = useCallback(
    async (id) => {
      const player = players.find((p) => p.id === id)
      if (!player) return
      await run(supabase.from('players').update({ paying: !player.paying }).eq('id', id))
    },
    [players, run]
  )

  const toggleRest = useCallback(
    async (id) => {
      const player = players.find((p) => p.id === id)
      if (!player) return
      await run(
        player.status === 'resting'
          ? supabase.rpc('resume_player_queue', { p_player_id: id })
          : supabase.from('players').update({ status: 'resting' }).eq('id', id),
      )
    },
    [players, run]
  )

  // เช็คชื่อหน้างาน: absent = ลงชื่อไว้แต่ไม่มา ไม่เข้าคิว และไม่ถูกนับเป็นตัวหารค่าใช้จ่าย
  const setAttendance = useCallback(
    async (playerId, present) => {
      await run(
        supabase.rpc('set_player_attendance', {
          p_player_id: playerId,
          p_present: present,
        }),
      )
    },
    [run]
  )

  const addCourt = useCallback(async () => {
    if (!sessionId) return
    await run(
      supabase.from('courts').insert({
        session_id: sessionId,
        name: `คอร์ต ${courts.length + 1}`,
        sort_order: courts.length,
      }),
    )
  }, [sessionId, courts.length, run])

  // ชั่วโมงที่จองของแต่ละคอร์ต — ใช้คิดค่าสนาม (ดู BillingPanel)
  const updateCourtHours = useCallback(
    async (courtId, hours) => {
      await run(supabase.from('courts').update({ hours }).eq('id', courtId))
    },
    [run]
  )

  const removeCourt = useCallback(async () => {
    const last = courts[courts.length - 1]
    if (!last) return
    await run(supabase.rpc('remove_court', { p_court_id: last.id }))
  }, [courts, run])

  // ผ่าน RPC เพราะต้องแก้ชื่อที่ snapshot ไว้ใน matches ของเกมที่ยังเล่นอยู่ด้วย
  const renameCourt = useCallback(
    async (courtId, name) => {
      const { error: err } = await supabase.rpc('rename_court', {
        p_court_id: courtId,
        p_name: name,
      })
      // โยนต่อ ไม่ใช่เก็บใส่ actionError เพราะ EditableName แสดง error เองในช่องกรอก
      if (err) throw new Error(err.message)
      await refetchAll()
    },
    [refetchAll],
  )

  const assignCourt = useCallback(
    async (courtId) => {
      const waiting = players.filter((p) => p.status === 'waiting')
      const match = pickNextMatch(waiting, { mode: queueMode, pairStats })
      if (!match) {
        setActionError('คนรอคิวไม่ครบ 4 คน')
        return
      }
      await run(
        supabase.rpc('assign_court', {
          p_court_id: courtId,
          p_team_a: match.teamA.map((p) => p.id),
          p_team_b: match.teamB.map((p) => p.id),
        }),
      )
    },
    [players, queueMode, pairStats, run]
  )

  // pending -> playing (เริ่มจับเวลา)
  const startMatch = useCallback(
    async (courtId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      await run(supabase.rpc('start_match', { p_match_id: court.match.id }))
    },
    [courts, run]
  )

  // เอาคนที่ยังไม่พร้อมออกไปพัก แล้วดึงคนแรกในคิวมาแทน (ทำได้เฉพาะตอน pending)
  const substitutePlayer = useCallback(
    async (courtId, playerId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      await run(
        supabase.rpc('substitute_player', {
          p_match_id: court.match.id,
          p_player_id: playerId,
        }),
      )
    },
    [courts, run]
  )

  const cancelMatch = useCallback(
    async (courtId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      await run(supabase.rpc('cancel_match', { p_match_id: court.match.id }))
    },
    [courts, run]
  )

  const finishMatch = useCallback(
    async (courtId) => {
      const court = courts.find((c) => c.id === courtId)
      if (!court?.match) return
      await run(supabase.rpc('finish_match', { p_match_id: court.match.id }))
    },
    [courts, run]
  )

  return {
    players,
    courts,
    history,
    summary,
    loading,
    actionError,
    clearActionError,
    // ดึงข้อมูลกระดานใหม่ทั้งชุด — ปุ่มรีเฟรชบนหน้าวันเล่นเรียกตัวนี้
    refresh: refetchAll,
    addPlayer,
    removePlayer,
    togglePaying,
    toggleRest,
    setAttendance,
    addCourt,
    removeCourt,
    renameCourt,
    updateCourtHours,
    assignCourt,
    startMatch,
    substitutePlayer,
    cancelMatch,
    finishMatch,
  }
}
