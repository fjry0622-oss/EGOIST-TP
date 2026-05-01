import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from './supabase';

const PRODUCTS = [
  { name: 'AIエンジニア', price: 770000, tp: 1540 },
  { name: 'VVプレミアム', price: 660000, tp: 1320 },
  { name: 'VVスタンダード', price: 440000, tp: 880 },
  { name: 'ミカヅキ', price: 330000, tp: 660 },
  { name: 'BR エキスパート', price: 440000, tp: 880 },
  { name: 'BR クリエイター', price: 770000, tp: 1540 },
  { name: 'BR Adobe エキスパート', price: 505000, tp: 1010 },
  { name: 'BR Adobe クリエイター', price: 835000, tp: 1670 },
  { name: 'BR ハイブリッドエキスパート', price: 615000, tp: 1230 },
  { name: 'BR ハイブリッドクリエイター', price: 945000, tp: 1890 },
  { name: 'SNS大学', price: 660000, tp: 1320 },
];

const SCENARIOS = {
  standard:  { label: '通常',   sub: 'A・Bのみ',     splits: { a1: 0.6,  b: 0.4 } },
  a2_normal: { label: 'A2一般', sub: 'チーム完結',    splits: { a1: 0.4,  a2: 0.3, b: 0.3 } },
  a2_exec:   { label: 'A2幹部', sub: '振分済み',      splits: { a1: 0.55, b: 0.45 } },
};

const ROLE_LABELS = { a1: 'A1', a2: 'A2', b: 'B' };

const MEMBERS = [
  '前田愛梨', '藤吉凌佑', '真弓智也', '岩川実央', '太田佳央理',
  '佐藤匡', '杉山一誠', '松下勇輝', '檜室秋蓮', '井上怜生', '中川明久',
];
const EXTERNAL = 'チーム外';

const RECORDER_KEY = 'egoist-recorder';

const SELECT_ARROW = {
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'%23a8a29e\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M7 10l5 5 5-5z\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.4rem center',
  backgroundSize: '1.3em',
};

// Map DB row -> app deal object
const fromRow = (r) => ({
  id: r.id,
  product: r.product,
  scenario: r.scenario,
  contributions: r.contributions,
  teamTP: r.team_tp,
  recorder: r.recorder,
  time: r.time,
});

export default function App() {
  const [productIdx, setProductIdx] = useState(0);
  const [scenario, setScenario] = useState('standard');
  const [assignees, setAssignees] = useState({ a1: MEMBERS[0], a2: EXTERNAL, b: MEMBERS[1] });
  const [history, setHistory] = useState([]);
  const [recorder, setRecorder] = useState('');
  const [flash, setFlash] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [showBoard, setShowBoard] = useState(true);
  const topRef = useRef(null);

  const fetchDeals = useCallback(async () => {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setHistory(data.map(fromRow));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(RECORDER_KEY);
    if (saved) setRecorder(saved);
    fetchDeals();
  }, [fetchDeals]);

  // Realtime subscription - immediately react to teammates' actions
  useEffect(() => {
    const channel = supabase
      .channel('deals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        fetchDeals();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDeals]);

  // Backup polling every 30s in case realtime drops
  useEffect(() => {
    const interval = setInterval(fetchDeals, 30000);
    return () => clearInterval(interval);
  }, [fetchDeals]);

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') fetchDeals(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [fetchDeals]);

  const product = PRODUCTS[productIdx];
  const { splits } = SCENARIOS[scenario];

  const isTeamMember = (name) => MEMBERS.includes(name);

  const contributions = useMemo(() => {
    return Object.entries(splits).map(([role, pct]) => {
      const assignee = assignees[role];
      const tp = Math.round(product.tp * pct);
      const isTeam = isTeamMember(assignee);
      return { role, pct, tp, assignee, isTeam };
    });
  }, [splits, assignees, product.tp]);

  const teamTP = contributions.reduce((s, c) => s + (c.isTeam ? c.tp : 0), 0);
  const recordedTP = history.reduce((s, h) => s + (h.teamTP || 0), 0);

  const memberTPs = useMemo(() => {
    const tally = Object.fromEntries(MEMBERS.map(m => [m, 0]));
    for (const deal of history) {
      const contribs = deal.contributions || [];
      for (const c of contribs) {
        if (c.isTeam && tally[c.assignee] !== undefined) {
          tally[c.assignee] += c.tp || 0;
        }
      }
    }
    return tally;
  }, [history]);

  const ranked = useMemo(() => {
    return MEMBERS
      .map(name => ({ name, tp: memberTPs[name] || 0 }))
      .sort((a, b) => b.tp - a.tp);
  }, [memberTPs]);
  const maxTP = ranked[0]?.tp || 1;

  const saveRecorder = (name) => {
    setRecorder(name);
    localStorage.setItem(RECORDER_KEY, name);
  };

  const setAssignee = (role, name) => {
    setAssignees({ ...assignees, [role]: name });
  };

  const record = async () => {
    if (teamTP === 0) return;
    setSyncing(true);
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const time = new Date().toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const row = {
      id,
      product: product.name,
      scenario,
      contributions: contributions.map(c => ({
        role: c.role, assignee: c.assignee, pct: c.pct, tp: c.tp, isTeam: c.isTeam,
      })),
      team_tp: teamTP,
      recorder: recorder || '匿名',
      time,
    };
    // Optimistic update
    setHistory([fromRow(row), ...history]);
    setFlash(teamTP);
    setTimeout(() => setFlash(0), 1400);

    const { error } = await supabase.from('deals').insert(row);
    if (error) {
      alert('記録に失敗しました: ' + error.message);
      await fetchDeals();
    }
    setSyncing(false);
    if (topRef.current) topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const remove = async (id) => {
    setSyncing(true);
    setHistory(history.filter((h) => h.id !== id));
    const { error } = await supabase.from('deals').delete().eq('id', id);
    if (error) {
      alert('削除に失敗しました: ' + error.message);
      await fetchDeals();
    }
    setSyncing(false);
  };

  const reset = async () => {
    if (!window.confirm('⚠ チーム全員の履歴を削除します。元に戻せません。本当に実行しますか?')) return;
    setSyncing(true);
    setHistory([]);
    const { error } = await supabase.from('deals').delete().neq('id', '');
    if (error) {
      alert('削除に失敗しました: ' + error.message);
      await fetchDeals();
    }
    setSyncing(false);
  };

  return (
    <div className="min-h-screen text-stone-100 pb-12 relative" style={{ background: '#0a0707' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Cinzel:wght@500;700;900&family=Noto+Sans+JP:wght@300;400;500;700;900&family=Noto+Serif+JP:wght@600;900&display=swap');
        body, html { font-family: 'Noto Sans JP', sans-serif; -webkit-tap-highlight-color: transparent; }
        .display { font-family: 'Anton', sans-serif; letter-spacing: 0.03em; font-weight: 400; }
        .wordmark { font-family: 'Cinzel', serif; font-weight: 700; }
        .kanji { font-family: 'Noto Serif JP', serif; font-weight: 900; }

        @keyframes pop {
          0%   { opacity: 0; transform: translate(-50%, 0%) scale(0.5); filter: blur(4px); }
          20%  { opacity: 1; transform: translate(-50%, -40%) scale(1.2); filter: blur(0); }
          100% { opacity: 0; transform: translate(-50%, -140%) scale(0.95); filter: blur(2px); }
        }
        .pop-anim { animation: pop 1.4s cubic-bezier(.2,.8,.2,1) forwards; position: absolute; left: 50%; top: 50%; }

        @keyframes pulseRingRed {
          0%   { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.6), inset 0 0 0 0 rgba(220, 38, 38, 0); }
          70%  { box-shadow: 0 0 0 32px rgba(220, 38, 38, 0), inset 0 0 16px 0 rgba(220, 38, 38, 0.3); }
          100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0), inset 0 0 0 0 rgba(220, 38, 38, 0); }
        }
        .pulse-ring { animation: pulseRingRed 1.1s ease-out; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .syncing { animation: spin 1s linear infinite; }

        @keyframes barGrow { from { width: 0; } }
        .bar-grow { animation: barGrow 0.7s cubic-bezier(.2,.8,.2,1); }

        .stripe-bg {
          background-image: repeating-linear-gradient(135deg,
            rgba(220, 38, 38, 0.04) 0,
            rgba(220, 38, 38, 0.04) 1px,
            transparent 1px,
            transparent 14px);
        }
        .vignette { background: radial-gradient(ellipse at top, rgba(127, 29, 29, 0.25) 0%, transparent 60%); }
        select { color-scheme: dark; }
        .crown::before, .crown::after {
          content: ''; display: inline-block; width: 18px; height: 1px;
          background: linear-gradient(to right, transparent, #dc2626);
          vertical-align: middle; margin: 0 12px;
        }
        .crown::after { background: linear-gradient(to left, transparent, #dc2626); }
      `}</style>

      <div className="flex items-center justify-between px-5 py-2 bg-black/60 border-b border-red-950/40 text-[10px]">
        <div className="flex items-center gap-1.5 text-stone-500">
          <span className="tracking-[0.25em]">RECORDER</span>
          <select
            value={recorder}
            onChange={(e) => saveRecorder(e.target.value)}
            className="bg-transparent text-stone-100 text-xs px-1 py-0.5 border-b border-red-700/60 outline-none cursor-pointer"
          >
            <option value="" disabled>選択してください</option>
            {MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 text-stone-600">
          <span className="tracking-[0.2em]">SHARED</span>
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${syncing ? 'bg-red-400' : 'bg-red-700'}`}
            style={syncing ? {} : { boxShadow: '0 0 6px rgba(220,38,38,0.8)' }}
          />
        </div>
      </div>

      <div ref={topRef} className="px-5 pt-7 pb-6 border-b border-red-950/60 relative overflow-hidden stripe-bg">
        <div className="absolute inset-0 vignette pointer-events-none" />
        <div
          className="absolute right-2 -top-4 kanji text-red-950/40 leading-none pointer-events-none select-none"
          style={{ fontSize: '180px' }}
          aria-hidden="true"
        >
          我
        </div>

        <div className="relative">
          <div className="text-center mb-1">
            <h1 className="wordmark text-3xl tracking-[0.5em] text-stone-100 inline-block crown" style={{ paddingLeft: '0.5em' }}>
              EGOIST
            </h1>
          </div>
          <div className="text-center text-[9px] tracking-[0.5em] text-red-800 mb-7">
            JUNE ・ 2026 ・ TEAM BATTLE
          </div>

          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] tracking-[0.35em] text-stone-500">TEAM ・ TOTAL</div>
            <div className="text-[10px] tabular-nums text-stone-600">{history.length}件</div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`display text-6xl text-red-500 inline-block ${flash ? 'pulse-ring rounded-sm' : ''}`}
              style={{ textShadow: '0 0 30px rgba(220, 38, 38, 0.4)' }}>
              {recordedTP.toLocaleString()}
            </span>
            <span className="display text-3xl text-red-900">TP</span>
          </div>
          <div className="text-xs text-stone-600 mt-0.5 tabular-nums">
            ¥{(recordedTP * 500).toLocaleString()} 相当
          </div>

          {flash > 0 && (
            <div
              className="display text-6xl pop-anim pointer-events-none"
              style={{ color: '#fca5a5', textShadow: '0 0 40px rgba(220, 38, 38, 0.9), 0 0 80px rgba(220, 38, 38, 0.5)' }}
            >
              +{flash.toLocaleString()}
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-4 border-b border-stone-900">
        <div className="text-[10px] tracking-[0.35em] text-stone-500 mb-2">商材</div>
        <select
          value={productIdx}
          onChange={(e) => setProductIdx(parseInt(e.target.value))}
          className="w-full bg-stone-950 border border-stone-800 rounded-sm px-3 py-3 text-sm appearance-none pr-9"
          style={SELECT_ARROW}
        >
          {PRODUCTS.map((p, i) => (
            <option key={i} value={i}>{p.name} ¥{p.price.toLocaleString()} / {p.tp}TP</option>
          ))}
        </select>
      </div>

      <div className="px-5 py-4 border-b border-stone-900">
        <div className="text-[10px] tracking-[0.35em] text-stone-500 mb-2">体制</div>
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(SCENARIOS).map(([key, { label, sub }]) => (
            <button
              key={key}
              onClick={() => setScenario(key)}
              className={`px-1 py-2.5 rounded-sm transition active:scale-[0.97] border ${
                scenario === key ? 'bg-red-600 text-stone-50 border-red-500' : 'bg-stone-950 border-stone-800 text-stone-500'
              }`}
              style={scenario === key ? { boxShadow: '0 0 20px -5px rgba(220, 38, 38, 0.6)' } : {}}
            >
              <div className="font-bold text-sm">{label}</div>
              <div className={`text-[10px] mt-0.5 ${scenario === key ? 'text-stone-200/80' : 'text-stone-600'}`}>{sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 border-b border-stone-900">
        <div className="text-[10px] tracking-[0.35em] text-stone-500 mb-3">役割割当</div>
        <div className="space-y-2">
          {contributions.map(({ role, pct, tp, assignee, isTeam }) => (
            <div key={role} className="flex items-center gap-2">
              <div className="flex flex-col items-center w-9 shrink-0">
                <span className="display text-xl text-stone-100 leading-none">{ROLE_LABELS[role]}</span>
                <span className="text-[9px] text-stone-600 tabular-nums mt-0.5">{Math.round(pct * 100)}%</span>
              </div>
              <select
                value={assignee}
                onChange={(e) => setAssignee(role, e.target.value)}
                className={`flex-1 min-w-0 border rounded-sm px-2 py-2 text-sm appearance-none pr-7 transition ${
                  isTeam
                    ? 'bg-red-950/30 border-red-800/70 text-stone-100'
                    : 'bg-stone-950 border-stone-800 text-stone-500'
                }`}
                style={SELECT_ARROW}
              >
                {MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
                <option value={EXTERNAL}>{EXTERNAL}</option>
              </select>
              <div className={`text-xs tabular-nums shrink-0 w-14 text-right ${isTeam ? 'text-red-400' : 'text-stone-700 line-through'}`}>
                {tp}TP
              </div>
            </div>
          ))}
        </div>
        {scenario === 'a2_exec' && (
          <p className="mt-3 text-[11px] text-stone-600 leading-relaxed">
            ※ 幹部A2の30%はA1とBに15%ずつ振り分け済み
          </p>
        )}
      </div>

      <div className="px-5 py-5 border-b border-stone-900 relative overflow-hidden">
        <div className="absolute inset-0 stripe-bg pointer-events-none opacity-50" />
        <div className="relative">
          <div className="text-[10px] tracking-[0.35em] text-stone-500 mb-1">THIS ・ DEAL</div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="display text-6xl text-stone-100">{teamTP.toLocaleString()}</span>
            <span className="display text-3xl text-stone-700">TP</span>
          </div>
          <div className="text-xs text-stone-500 mb-4 tabular-nums">¥{(teamTP * 500).toLocaleString()}</div>
          <button
            onClick={record}
            disabled={teamTP === 0 || syncing}
            className={`w-full py-4 rounded-sm display text-2xl tracking-[0.2em] transition active:scale-[0.98] border flex items-center justify-center gap-3 ${
              teamTP === 0 || syncing
                ? 'bg-stone-950 text-stone-700 border-stone-900 cursor-not-allowed'
                : 'bg-red-600 text-stone-50 border-red-500 hover:bg-red-500'
            }`}
            style={teamTP > 0 && !syncing ? { boxShadow: '0 0 35px -8px rgba(220, 38, 38, 0.7), inset 0 1px 0 rgba(255,255,255,0.08)' } : {}}
          >
            {syncing && <span className="syncing inline-block w-4 h-4 border-2 border-stone-50/40 border-t-stone-50 rounded-full" />}
            STRIKE +{teamTP.toLocaleString()}TP
          </button>
        </div>
      </div>

      <div className="px-5 mt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] tracking-[0.35em] text-stone-500">LEADERBOARD</div>
          <button onClick={() => setShowBoard(!showBoard)} className="text-[10px] tracking-widest text-stone-700 active:text-stone-400 px-1">
            {showBoard ? '隠す' : '表示'}
          </button>
        </div>
        {showBoard && (
          <div className="space-y-1">
            {ranked.map((m, i) => {
              const widthPct = maxTP > 0 ? (m.tp / maxTP) * 100 : 0;
              const isTop = i === 0 && m.tp > 0;
              const isMe = m.name === recorder;
              const isZero = m.tp === 0;
              return (
                <div key={m.name} className={`py-2 px-2 -mx-2 rounded-sm ${isMe ? 'bg-red-950/30 ring-1 ring-red-900/40' : ''}`}>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`display text-lg w-6 text-center tabular-nums ${isTop ? 'text-red-400' : 'text-stone-700'}`}>
                      {i + 1}
                    </span>
                    <span className={`flex-1 text-sm truncate ${isZero ? 'text-stone-700' : isTop ? 'text-stone-50 font-bold' : 'text-stone-100'}`}>
                      {isTop && '👑 '}{m.name}
                      {isMe && <span className="ml-1.5 text-[9px] tracking-[0.2em] text-red-600">YOU</span>}
                    </span>
                    <span className={`display text-xl tabular-nums ${isZero ? 'text-stone-800' : isTop ? 'text-red-300' : 'text-red-400'}`}
                      style={isTop && !isZero ? { textShadow: '0 0 14px rgba(220, 38, 38, 0.6)' } : {}}>
                      {m.tp.toLocaleString()}
                    </span>
                    <span className="display text-xs text-stone-700">TP</span>
                  </div>
                  <div className="ml-8 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-stone-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bar-grow"
                        style={{
                          width: `${widthPct}%`,
                          background: isZero
                            ? 'transparent'
                            : isTop
                              ? 'linear-gradient(to right, #b91c1c, #fca5a5)'
                              : 'linear-gradient(to right, #7f1d1d, #dc2626)',
                          boxShadow: isTop && !isZero ? '0 0 8px rgba(220, 38, 38, 0.5)' : 'none',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-stone-700 tabular-nums w-20 text-right">
                      ¥{(m.tp * 500).toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-5 mt-6">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] tracking-[0.35em] text-stone-500">CONQUEST ・ LOG</div>
          {history.length > 0 && (
            <button onClick={reset} className="text-[10px] tracking-widest text-stone-700 active:text-stone-400 px-1">
              CLEAR ALL
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-stone-700 tracking-widest">NO RECORDS YET</div>
        ) : (
          <div>
            {history.map((h) => {
              const teamContribs = (h.contributions || []).filter(c => c.isTeam);
              return (
                <div key={h.id} className="flex justify-between items-start py-2.5 border-b border-stone-900 gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm truncate">{h.product}</span>
                      <span className="text-[10px] text-stone-600 shrink-0">{SCENARIOS[h.scenario]?.label}</span>
                    </div>
                    <div className="text-[10px] text-stone-600 mt-0.5 leading-relaxed">
                      {teamContribs.map((c, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-stone-800 mx-1">/</span>}
                          <span className="text-stone-700">{ROLE_LABELS[c.role]}</span>{' '}
                          <span className="text-red-700">{c.assignee}</span>
                        </span>
                      ))}
                      <span className="text-stone-800 mx-1.5">・</span>
                      <span>{h.time}</span>
                    </div>
                  </div>
                  <div className="display text-2xl text-red-500 tabular-nums shrink-0">
                    +{(h.teamTP || 0).toLocaleString()}
                  </div>
                  <button
                    onClick={() => remove(h.id)}
                    className="text-stone-700 active:text-stone-400 text-lg w-6 h-6 flex items-center justify-center shrink-0"
                    aria-label="削除"
                  >×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-5 mt-7 text-center">
        <div className="text-[9px] tracking-[0.5em] text-stone-700">EGOIST ・ 唯我独尊</div>
        <div className="mt-2 text-[10px] text-stone-700 leading-relaxed">
          1TP = ¥500(税込) ・ 履歴はチームでリアルタイム共有
        </div>
      </div>
    </div>
  );
}
