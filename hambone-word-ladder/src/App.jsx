import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const APP_NAME = "Hambone's Word Ladder";
const NAVY = '#092137';
const CREAM = '#FEF8D0';
const ORANGE = '#F48717';
const GOLD = '#EEC918';
const NAVY_CARD = '#0d2843';
const LOGO = '/hambone.png';

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQhh8egf_E5bZQ8s_ijh30Kbfsbk-VSjbebGIzyC1qDbfXnjVcYvCkDxcIDKyxV3omoZPCUzX-lLpbs/pub?output=csv";

function getSessionId() {
  let id = localStorage.getItem('wl_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('wl_session_id', id);
  }
  return id;
}

function getTodayKey() {
  const now = new Date();
  const estOffset = isDaylightSaving(now) ? 4 : 5;
  const estTime = new Date(now.getTime() - estOffset * 60 * 60 * 1000);
  const adjustedTime = new Date(estTime.getTime() - 7 * 60 * 60 * 1000);
  return adjustedTime.toISOString().slice(0, 10);
}

function isDaylightSaving(date) {
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  return date.getTimezoneOffset() < stdOffset;
}

function getPast7Days() {
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

async function fetchAllLadders() {
  const response = await fetch(SHEET_URL);
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

  const rows = lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuotes = !inQuotes;
      else if (line[i] === ',' && !inQuotes) { values.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
      else current += line[i];
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  }).filter(r => r.status === 'app-ready');

  return rows;
}

function buildLadderForDate(allRows, date) {
  const rows = allRows
    .filter(r => r.ladder_date === date)
    .sort((a, b) => parseInt(a.position) - parseInt(b.position));
  if (rows.length !== 5) return null;
  return {
    questions: rows,
    theme: rows.find(r => r.theme)?.theme || null
  };
}

async function getStreak(sessionId) {
  const { data } = await supabase
    .from('ladder_streaks')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data || { streak: 0, best_streak: 0, last_played_date: null };
}

async function updateStreak(sessionId) {
  const today = getTodayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('ladder_streaks')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  let newStreak = 1;
  let newBest = 1;

  if (existing) {
    if (existing.last_played_date === yesterdayKey) {
      newStreak = existing.streak + 1;
    } else if (existing.last_played_date === today) {
      return existing;
    }
    newBest = Math.max(existing.best_streak || 0, newStreak);
    await supabase.from('ladder_streaks').update({
      streak: newStreak,
      best_streak: newBest,
      last_played_date: today
    }).eq('session_id', sessionId);
  } else {
    await supabase.from('ladder_streaks').insert({
      session_id: sessionId,
      streak: 1,
      best_streak: 1,
      last_played_date: today
    });
  }

  return { streak: newStreak, best_streak: newBest };
}

async function saveResponse(sessionId, date, answers, score) {
  await supabase.from('ladder_responses').upsert({
    session_id: sessionId,
    ladder_date: date,
    a1: answers[0] || '',
    a2: answers[1] || '',
    a3: answers[2] || '',
    a4: answers[3] || '',
    a5: answers[4] || '',
    score
  }, { onConflict: 'session_id,ladder_date' });
}

async function getResponseForDate(sessionId, date) {
  const { data } = await supabase
    .from('ladder_responses')
    .select('*')
    .eq('session_id', sessionId)
    .eq('ladder_date', date)
    .maybeSingle();
  return data;
}

async function getAllResponses(sessionId) {
  const { data } = await supabase
    .from('ladder_responses')
    .select('*')
    .eq('session_id', sessionId);
  return data || [];
}

function normalize(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

function checkAnswer(input, question) {
  const userAnswer = normalize(input);
  if (!userAnswer) return false;
  const targets = [question.answer, ...(question.aliases ? question.aliases.split('|') : [])].map(normalize);
  const isNumeric = targets.some(t => /^\d+$/.test(t));
  for (const target of targets) {
    if (isNumeric) {
      if (userAnswer === target) return true;
    } else {
      if (userAnswer === target) return true;
      if (levenshtein(userAnswer, target) <= Math.max(1, Math.floor(target.length * 0.25))) return true;
    }
  }
  return false;
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [allRows, setAllRows] = useState([]);
  const [activeLadder, setActiveLadder] = useState(null);
  const [activeDate, setActiveDate] = useState(null);
  const [answers, setAnswers] = useState(['', '', '', '', '']);
  const [finalAnswers, setFinalAnswers] = useState(['', '', '', '', '']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streakData, setStreakData] = useState({ streak: 0, best_streak: 0 });
  const [todayPlayed, setTodayPlayed] = useState(false);
  const [todayResponse, setTodayResponse] = useState(null);
  const [correctPct, setCorrectPct] = useState(null);
  const [playedDates, setPlayedDates] = useState({});
  const sessionId = getSessionId();
  const today = getTodayKey();
  const todayFormatted = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    async function init() {
      try {
        const [rows, streak, todayResp, allResponses] = await Promise.all([
          fetchAllLadders(),
          getStreak(sessionId),
          getResponseForDate(sessionId, today),
          getAllResponses(sessionId)
        ]);

        setAllRows(rows);
        setStreakData(streak);

        const played = {};
        allResponses.forEach(r => { played[r.ladder_date] = r; });
        setPlayedDates(played);

        if (todayResp) {
          setTodayPlayed(true);
          setTodayResponse(todayResp);
          setFinalAnswers([todayResp.a1, todayResp.a2, todayResp.a3, todayResp.a4, todayResp.a5]);
        }

        if (allResponses.length > 0) {
          const totalPoints = allResponses.reduce((acc, r) => acc + (r.score || 0), 0);
          const totalPossible = allResponses.length * 5;
          setCorrectPct(Math.round((totalPoints / totalPossible) * 100));
        }

      } catch (e) {
        console.error('Init error:', e);
        setError('Something went wrong loading the app.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  function playDate(date) {
    const ladder = buildLadderForDate(allRows, date);
    if (!ladder) return;
    setActiveLadder(ladder);
    setActiveDate(date);
    const existing = playedDates[date];
    if (existing) {
      setFinalAnswers([existing.a1, existing.a2, existing.a3, existing.a4, existing.a5]);
      setTodayResponse(existing);
      setScreen('results');
    } else {
      setAnswers(['', '', '', '', '']);
      setScreen('play');
    }
  }

  async function handleSubmit() {
    const ladder = activeLadder;
    const score = ladder.questions.reduce((acc, q, i) => {
      return acc + (checkAnswer(answers[i], q) ? 1 : 0);
    }, 0);

    await saveResponse(sessionId, activeDate, answers, score);

    const isToday = activeDate === today;
    if (isToday) {
      const newStreak = await updateStreak(sessionId);
      setStreakData(newStreak);
      setTodayPlayed(true);
      setTodayResponse({ score });
    }

    const newPlayed = { ...playedDates, [activeDate]: { score, a1: answers[0], a2: answers[1], a3: answers[2], a4: answers[3], a5: answers[4] } };
    setPlayedDates(newPlayed);

    const totalPoints = Object.values(newPlayed).reduce((acc, r) => acc + (r.score || 0), 0);
    const totalPossible = Object.keys(newPlayed).length * 5;
    setCorrectPct(Math.round((totalPoints / totalPossible) * 100));

    setFinalAnswers([...answers]);
    setScreen('results');
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', background: NAVY }}>
      <img src={LOGO} alt="Hambone's" style={{ width: 80, height: 80, marginBottom: 20 }} />
      <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '2rem', fontWeight: 400, color: CREAM, marginBottom: 8 }}>{APP_NAME}</h1>
      <p style={{ color: ORANGE, fontSize: '0.9rem', fontStyle: 'italic' }}>Climbing the ladder...</p>
    </div>
  );

  if (error) return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem', minHeight: '100vh' }}>
      <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '2rem', fontWeight: 400, color: CREAM }}>{APP_NAME}</h1>
      <p style={{ color: '#f87171', marginTop: '2rem' }}>{error}</p>
    </div>
  );

  const past7 = getPast7Days().filter(d => buildLadderForDate(allRows, d));

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.75rem', fontWeight: 400, color: CREAM }}>{APP_NAME}</h1>
          {screen !== 'home' && (
            <img src={LOGO} alt="Hambone's" style={{ width: 28, height: 28, flexShrink: 0 }} />
          )}
        </div>
        <p style={{ color: CREAM, fontSize: '0.75rem', marginTop: 6, opacity: 0.5 }}>
          Each correct answer begins with the last letter of the answer before it.
        </p>
      </div>

      {screen === 'home' && (
        <HomeScreen
          today={todayFormatted}
          streakData={streakData}
          correctPct={correctPct}
          todayPlayed={todayPlayed}
          todayResponse={todayResponse}
          todayAvailable={!!buildLadderForDate(allRows, today)}
          onPlayToday={() => playDate(today)}
          onReviewToday={() => {
            setActiveLadder(buildLadderForDate(allRows, today));
            setActiveDate(today);
            setFinalAnswers([playedDates[today]?.a1, playedDates[today]?.a2, playedDates[today]?.a3, playedDates[today]?.a4, playedDates[today]?.a5]);
            setScreen('results');
          }}
          past7={past7}
          playedDates={playedDates}
          onPlayPast={(date) => playDate(date)}
          hasTodayResults={todayPlayed}
        />
      )}
      {screen === 'play' && (
        <PlayScreen
          ladder={activeLadder}
          activeDate={activeDate}
          answers={answers}
          setAnswers={setAnswers}
          onSubmit={handleSubmit}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'results' && (
        <ResultsScreen
          ladder={activeLadder}
          activeDate={activeDate}
          userAnswers={finalAnswers}
          streakData={streakData}
          todayResponse={todayResponse}
          onHome={() => setScreen('home')}
        />
      )}
    </div>
  );
}

function HomeScreen({ today, streakData, correctPct, todayPlayed, todayResponse, todayAvailable, onPlayToday, onReviewToday, past7, playedDates, onPlayPast, hasTodayResults }) {
  return (
    <div>
      <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5, marginBottom: '1rem', textAlign: 'center' }}>{today}</p>

      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <p style={{ fontSize: '0.65rem', color: CREAM, opacity: 0.4, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>brought to you by</p>
        <img src={LOGO} alt="Hambone's Trivia" style={{ width: 80, height: 80 }} />
      </div>

      <div style={{ background: NAVY_CARD, border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 14, padding: '1.5rem', marginBottom: '1.25rem', textAlign: 'center' }}>
        {todayPlayed ? (
          <>
            <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.5, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>today's score</p>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '3.5rem', fontWeight: 400, color: CREAM, lineHeight: 1 }}>{todayResponse.score}/5</p>
            <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5, marginTop: 10 }}>Come back tomorrow for a new ladder!</p>
            <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.3, marginTop: 6 }}>New ladder every day at 7 a.m. Eastern</p>
          </>
        ) : todayAvailable ? (
          <>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.4rem', fontWeight: 400, marginBottom: 8, color: CREAM }}>Today's ladder is ready.</p>
            <p style={{ fontSize: '0.875rem', color: CREAM, opacity: 0.6, lineHeight: 1.6 }}>5 questions. One chain. Can you climb it?</p>
          </>
        ) : (
          <>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.4rem', fontWeight: 400, marginBottom: 8, color: CREAM }}>No ladder today yet.</p>
            <p style={{ fontSize: '0.875rem', color: CREAM, opacity: 0.6 }}>Check back soon!</p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: '0.75rem' }}>
        <StatPill label="Current streak" value={`${streakData.streak || 0} days`} />
        <StatPill label="Longest streak" value={`${streakData.best_streak || 0} days`} />
        {correctPct !== null && <StatPill label="Correct %" value={`${correctPct}%`} />}
      </div>

      <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.3, textAlign: 'center', marginBottom: '1.25rem' }}>New ladder every day at 7 a.m. Eastern</p>

      {!todayPlayed && todayAvailable && (
        <button onClick={onPlayToday} style={{
          width: '100%', padding: '1rem', background: ORANGE, color: CREAM, border: 'none',
          borderRadius: 12, fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif'
        }}>
          Climb today's ladder →
        </button>
      )}

      {todayPlayed && hasTodayResults && (
        <button onClick={onReviewToday} style={{
          width: '100%', padding: '1rem', background: 'transparent', color: CREAM,
          border: `1.5px solid rgba(254,248,208,0.25)`, borderRadius: 12, fontSize: '1rem',
          fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif'
        }}>
          Review today's answers →
        </button>
      )}

      {past7.length > 0 && (
        <div style={{ marginTop: '1.75rem' }}>
          <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.4, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Past Ladders</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {past7.map(date => {
              const played = playedDates[date];
              return (
                <button key={date} onClick={() => onPlayPast(date)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.875rem 1.25rem', background: NAVY_CARD,
                  border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 12,
                  cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'border-color 0.15s'
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(244,135,23,0.4)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(254,248,208,0.1)'}
                >
                  <span style={{ color: CREAM, fontSize: '0.9rem' }}>{formatDate(date)}</span>
                  {played ? (
                    <span style={{ color: '#4ade80', fontSize: '0.8rem', fontWeight: 600 }}>{played.score}/5 ✓</span>
                  ) : (
                    <span style={{ color: ORANGE, fontSize: '0.8rem', fontWeight: 600 }}>Play →</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayScreen({ ladder, activeDate, answers, setAnswers, onSubmit, onBack }) {
  const allFilled = answers.every(a => a.trim());
  const today = getTodayKey();
  const isPast = activeDate !== today;

  return (
    <div>
      {isPast && (
        <div style={{ marginBottom: '1rem' }}>
          <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: CREAM, opacity: 0.6, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif', padding: 0 }}>
            ← Back
          </button>
          <p style={{ color: GOLD, fontSize: '0.8rem', marginTop: 6 }}>Playing: {formatDate(activeDate)}</p>
        </div>
      )}

      {ladder.theme && (
        <div style={{ background: 'rgba(238,201,24,0.1)', border: `1px solid rgba(238,201,24,0.3)`, borderRadius: 12, padding: '0.875rem 1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: GOLD, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>today's theme</p>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, color: CREAM }}>{ladder.theme}</p>
        </div>
      )}

      <div style={{
        background: 'rgba(244,135,23,0.08)',
        border: `1px solid rgba(244,135,23,0.2)`,
        borderRadius: 12,
        padding: '0.875rem 1.25rem',
        marginBottom: '1.5rem'
      }}>
        <p style={{ fontSize: '0.8rem', color: ORANGE, lineHeight: 1.6, textAlign: 'center' }}>
          Each correct answer begins with the last letter of the answer before it — and Q5 loops back to Q1.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {ladder.questions.map((q, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', color: ORANGE, fontWeight: 700, minWidth: 20 }}>{i + 1}.</span>
              <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.1rem', fontWeight: 400, lineHeight: 1.4, color: CREAM }}>{q.question}</p>
            </div>
            <input
              type="text"
              value={answers[i]}
              onChange={e => {
                const updated = [...answers];
                updated[i] = e.target.value;
                setAnswers(updated);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const next = document.getElementById(`answer-${i + 1}`);
                  if (next) next.focus();
                }
              }}
              id={`answer-${i}`}
              placeholder="Your answer..."
              style={{
                width: '100%', padding: '0.75rem 1rem', fontSize: '1rem',
                border: `1.5px solid rgba(254,248,208,0.2)`, borderRadius: 10, outline: 'none',
                background: NAVY_CARD, fontFamily: 'Inter, sans-serif', color: CREAM, transition: 'border-color 0.15s'
              }}
              onFocus={e => e.target.style.borderColor = ORANGE}
              onBlur={e => e.target.style.borderColor = 'rgba(254,248,208,0.2)'}
            />
          </div>
        ))}
      </div>

      <button onClick={onSubmit} disabled={!allFilled} style={{
        width: '100%', padding: '1rem',
        background: allFilled ? ORANGE : 'rgba(244,135,23,0.3)',
        color: CREAM, border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 700,
        cursor: allFilled ? 'pointer' : 'default', fontFamily: 'Inter, sans-serif', transition: 'background 0.15s'
      }}>
        Submit answers →
      </button>
    </div>
  );
}

function ResultsScreen({ ladder, activeDate, userAnswers, streakData, todayResponse, onHome }) {
  const [copied, setCopied] = useState(false);
  const today = getTodayKey();
  const isPast = activeDate !== today;
  const score = ladder.questions.reduce((acc, q, i) => acc + (checkAnswer(userAnswers[i] || '', q) ? 1 : 0), 0);
  const correctAnswers = ladder.questions.map(q => q.answer);

  const emojiRow = ladder.questions.map((q, i) =>
    checkAnswer(userAnswers[i] || '', q) ? '🟩' : '🟥'
  ).join(' ');

  const shareText = `Hambone's Word Ladder\n${formatDate(activeDate)} — ${score}/5\n\n${emojiRow}\n\nPlay today's ladder: hambone-word-ladder.vercel.app`;

  const perfectMessages = [
    "Perfect! Can you do it again tomorrow?",
    "Flawless ladder. The pig is impressed. 🐷",
    "5/5. You are built different.",
  ];
  const perfectMsg = perfectMessages[Math.floor(Math.random() * perfectMessages.length)];

  function copyShare() {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function nativeShare() {
    navigator.share({ title: "Hambone's Word Ladder", text: shareText, url: 'https://hambone-word-ladder.vercel.app' }).catch(() => {});
  }

  return (
    <div>
      {isPast && (
        <div style={{ marginBottom: '1rem' }}>
          <button onClick={onHome} style={{ background: 'transparent', border: 'none', color: CREAM, opacity: 0.6, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif', padding: 0 }}>
            ← Back to home
          </button>
          <p style={{ color: GOLD, fontSize: '0.8rem', marginTop: 6 }}>{formatDate(activeDate)}</p>
        </div>
      )}

      <div style={{ background: NAVY_CARD, border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 14, padding: '1.75rem', marginBottom: '1rem', textAlign: 'center' }}>
        <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.5, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {isPast ? formatDate(activeDate) : "today's score"}
        </p>
        <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '4rem', fontWeight: 400, color: CREAM, lineHeight: 1 }}>{score}/5</p>
        {score === 5 && <p style={{ color: GOLD, fontSize: '0.9rem', fontWeight: 600, marginTop: 10 }}>{perfectMsg}</p>}
        {!isPast && streakData.streak > 0 && (
          <p style={{ color: ORANGE, fontSize: '0.9rem', fontWeight: 600, marginTop: 8 }}>🔥 {streakData.streak} day streak</p>
        )}
      </div>

      <div style={{ background: NAVY_CARD, border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 14, padding: '1.25rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.4, marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>the chain</p>
        <p style={{ fontSize: '0.95rem', lineHeight: 1.8, wordBreak: 'break-word' }}>
          {correctAnswers.map((ans, i) => (
            <span key={i}>
              <span style={{ color: checkAnswer(userAnswers[i] || '', ladder.questions[i]) ? '#4ade80' : '#f87171', fontWeight: 600 }}>{ans}</span>
              {i < correctAnswers.length - 1 && <span style={{ color: CREAM, opacity: 0.4 }}> → </span>}
            </span>
          ))}
          <span style={{ color: CREAM, opacity: 0.4 }}> → ↩</span>
        </p>
      </div>

      {ladder.questions.map((q, i) => {
        const accepted = checkAnswer(userAnswers[i] || '', q);
        return (
          <div key={i} style={{ background: NAVY_CARD, border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 14, padding: '1.25rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Q{i + 1}</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: accepted ? '#4ade80' : '#f87171', background: accepted ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', padding: '2px 10px', borderRadius: 20 }}>
                {accepted ? '✓ correct' : '✗ incorrect'}
              </span>
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 500, marginBottom: 8, lineHeight: 1.5, color: CREAM }}>{q.question}</p>
            <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5, marginBottom: 4 }}>
              Your answer: <span style={{ color: CREAM, opacity: 0.8 }}>{userAnswers[i] || '—'}</span>
            </p>
            <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5 }}>
              Correct answer: <span style={{ color: CREAM, fontWeight: 600, opacity: 1 }}>{q.answer}</span>
            </p>
            {q.explanation && (
              <p style={{ fontSize: '0.85rem', color: GOLD, lineHeight: 1.6, marginTop: 10, paddingTop: 10, borderTop: `1px solid rgba(254,248,208,0.1)`, fontStyle: 'italic' }}>{q.explanation}</p>
            )}
          </div>
        );
      })}

      <div style={{ background: NAVY_CARD, border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 14, padding: '1.25rem', marginBottom: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', color: CREAM, opacity: 0.8 }}>{shareText}</div>

      <div style={{ display: 'flex', gap: 10, marginBottom: '0.75rem' }}>
        {navigator.share && (
          <button type="button" onClick={nativeShare} style={{ flex: 1, padding: '1rem', background: ORANGE, color: CREAM, border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Share ↗</button>
        )}
        <button type="button" onClick={copyShare} style={{ flex: 1, padding: '1rem', background: copied ? '#4ade80' : 'transparent', color: copied ? NAVY : CREAM, border: copied ? '1.5px solid #4ade80' : `1.5px solid rgba(254,248,208,0.25)`, borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.2s' }}>
          {copied ? '✓ Copied!' : 'Copy results'}
        </button>
      </div>

      <button type="button" onClick={onHome} style={{ width: '100%', padding: '1rem', background: ORANGE, color: CREAM, border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>← Back to home</button>
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div style={{ flex: 1, background: NAVY_CARD, border: `1px solid rgba(254,248,208,0.1)`, borderRadius: 10, padding: '0.75rem 1rem', textAlign: 'center' }}>
      <p style={{ fontSize: '0.7rem', color: CREAM, opacity: 0.4, marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: CREAM }}>{value}</p>
    </div>
  );
}