import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const NAVY = '#092137';
const CREAM = '#FEF8D0';
const ORANGE = '#F48717';
const GOLD = '#EEC918';
const NAVY_CARD = '#0d2843';

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQhh8egf_E5bZQ8s_ijh30Kbfsbk-VSjbebGIzyC1qDbfXnjVcYvCkDxcIDKyxV3omoZPCUzX-lLpbs/pub?output=csv";

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

async function fetchTodayLadder() {
  const today = getTodayKey();
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
  });

  return rows
    .filter(r => r.ladder_date === today && r.status === 'app-ready')
    .sort((a, b) => parseInt(a.position) - parseInt(b.position));
}

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [todayLadder, setTodayLadder] = useState(null);
  const [loading, setLoading] = useState(false);

  function handleLogin() {
    if (password.toUpperCase() === 'HAMBONE') {
      setAuthed(true);
      loadData();
    } else {
      setError('Incorrect password.');
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const today = getTodayKey();

      const { data: responses } = await supabase
        .from('ladder_responses')
        .select('*')
        .order('completed_at', { ascending: false });

      const { data: streaks } = await supabase
        .from('ladder_streaks')
        .select('*');

      const ladder = await fetchTodayLadder();
      setTodayLadder(ladder);

      const uniquePlayers = new Set(responses?.map(r => r.session_id)).size;
      const totalCompletions = responses?.length || 0;

      const last7 = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = d.toISOString().slice(0, 10);
        const dayResponses = responses?.filter(r => r.ladder_date === dateKey) || [];
        const avgScore = dayResponses.length
          ? (dayResponses.reduce((acc, r) => acc + (r.score || 0), 0) / dayResponses.length).toFixed(1)
          : null;
        const perfectCount = dayResponses.filter(r => r.score === 5).length;
        last7.push({ date: dateKey, count: dayResponses.length, avgScore, perfectCount });
      }

      const answerStats = [1, 2, 3, 4, 5].map(pos => {
        const key = `a${pos}`;
        const todayAnswers = responses
          ?.filter(r => r.ladder_date === today && r[key])
          .map(r => r[key].toLowerCase().trim()) || [];
        const counts = {};
        todayAnswers.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return { position: pos, answers: sorted };
      });

      setStats({ uniquePlayers, totalCompletions, last7, answerStats, streaks: streaks?.length || 0 });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (!authed) return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: NAVY,
      padding: '2rem'
    }}>
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <p style={{ color: CREAM, fontSize: '1.5rem', fontFamily: "'DM Serif Display', serif", marginBottom: 24 }}>Admin Dashboard</p>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="Password"
          style={{
            width: '100%',
            padding: '0.875rem 1rem',
            fontSize: '1rem',
            border: `1.5px solid rgba(254,248,208,0.2)`,
            borderRadius: 10,
            outline: 'none',
            background: NAVY_CARD,
            color: CREAM,
            marginBottom: 12,
            fontFamily: 'Inter, sans-serif'
          }}
        />
        {error && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>{error}</p>}
        <button onClick={handleLogin} style={{
          width: '100%',
          padding: '0.875rem',
          background: ORANGE,
          color: CREAM,
          border: 'none',
          borderRadius: 10,
          fontSize: '1rem',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif'
        }}>Enter</button>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: NAVY }}>
      <p style={{ color: CREAM }}>Loading...</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1.25rem', background: NAVY, minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.75rem', color: CREAM }}>Word Ladder Admin</h1>
        <button onClick={loadData} style={{
          padding: '0.5rem 1rem',
          background: 'transparent',
          color: ORANGE,
          border: `1px solid ${ORANGE}`,
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontFamily: 'Inter, sans-serif'
        }}>Refresh</button>
      </div>

      {/* Today's ladder */}
      <Section title="Today's Ladder">
        {todayLadder?.length === 5 ? (
          <div>
            {todayLadder.map((q, i) => (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < 4 ? `1px solid rgba(254,248,208,0.1)` : 'none' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span style={{ color: ORANGE, fontWeight: 700, fontSize: '0.85rem', minWidth: 20 }}>{i + 1}.</span>
                  <div>
                    <p style={{ color: CREAM, fontSize: '0.9rem', marginBottom: 3 }}>{q.question}</p>
                    <p style={{ color: GOLD, fontSize: '0.85rem', fontWeight: 600 }}>→ {q.answer}</p>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12, padding: '0.75rem', background: 'rgba(238,201,24,0.1)', borderRadius: 8 }}>
              <p style={{ color: GOLD, fontSize: '0.85rem', fontWeight: 600 }}>
                Chain: {todayLadder.map(q => q.answer).join(' → ')} → ↩
              </p>
              {todayLadder[0]?.theme && (
                <p style={{ color: CREAM, opacity: 0.7, fontSize: '0.8rem', marginTop: 4 }}>Theme: {todayLadder[0].theme}</p>
              )}
            </div>
          </div>
        ) : (
          <p style={{ color: '#f87171', fontSize: '0.9rem' }}>⚠️ No ladder found for today — check the sheet!</p>
        )}
      </Section>

      {/* Overview stats */}
      <Section title="Overview">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatCard label="Unique Players" value={stats?.uniquePlayers || 0} />
          <StatCard label="Total Completions" value={stats?.totalCompletions || 0} />
          <StatCard label="Active Streaks" value={stats?.streaks || 0} />
        </div>
      </Section>

      {/* Last 7 days */}
      <Section title="Last 7 Days">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr>
              {['Date', 'Players', 'Avg Score', 'Perfect (5/5)'].map(h => (
                <th key={h} style={{ color: CREAM, opacity: 0.5, textAlign: 'left', paddingBottom: 8, fontWeight: 500, fontSize: '0.75rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats?.last7.map((day, i) => (
              <tr key={i} style={{ borderTop: `1px solid rgba(254,248,208,0.08)` }}>
                <td style={{ color: CREAM, padding: '8px 0' }}>{day.date}</td>
                <td style={{ color: CREAM, padding: '8px 0' }}>{day.count || '—'}</td>
                <td style={{ color: day.avgScore ? ORANGE : CREAM, opacity: day.avgScore ? 1 : 0.4, padding: '8px 0' }}>{day.avgScore || '—'}</td>
                <td style={{ color: day.perfectCount > 0 ? GOLD : CREAM, opacity: day.perfectCount > 0 ? 1 : 0.4, padding: '8px 0' }}>{day.perfectCount || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Today's answer breakdown */}
      <Section title="Today's Answer Breakdown">
        {stats?.answerStats.map((q, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <p style={{ color: ORANGE, fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Q{q.position}</p>
            {q.answers.length > 0 ? (
              q.answers.map(([ans, count], j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid rgba(254,248,208,0.05)` }}>
                  <span style={{ color: CREAM, fontSize: '0.875rem' }}>{ans}</span>
                  <span style={{ color: GOLD, fontSize: '0.875rem', fontWeight: 600 }}>{count}</span>
                </div>
              ))
            ) : (
              <p style={{ color: CREAM, opacity: 0.4, fontSize: '0.85rem' }}>No answers yet today</p>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{
      background: NAVY_CARD,
      border: `1px solid rgba(254,248,208,0.1)`,
      borderRadius: 14,
      padding: '1.25rem',
      marginBottom: '1.25rem'
    }}>
      <p style={{ color: CREAM, opacity: 0.5, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>{title}</p>
      {children}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 120,
      background: 'rgba(254,248,208,0.05)',
      borderRadius: 10,
      padding: '0.875rem 1rem',
      textAlign: 'center'
    }}>
      <p style={{ color: CREAM, opacity: 0.5, fontSize: '0.7rem', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</p>
      <p style={{ color: CREAM, fontSize: '1.5rem', fontWeight: 700 }}>{value}</p>
    </div>
  );
}