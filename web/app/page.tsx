'use client';
import React, { useEffect, useMemo, useState } from 'react';

type InventoryRow = {
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
};

type HistoryRow = {
  created_at: string;
  direction: 'IN' | 'OUT' | 'ADJUST';
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
  created_by: string;
  memo?: string;
};

type MovementPayload = {
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
  direction: 'IN' | 'OUT' | 'ADJUST';
  memo: string;
  idempotencyKey: string;
};

const EMPTY_MOVEMENT: MovementPayload = {
  artist: '',
  category: 'album',
  album_version: '',
  option: '',
  location: '',
  quantity: 0,
  direction: 'IN',
  memo: '',
  idempotencyKey: ''
};

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card">
      <div className="section-heading">
        <h2>{title}</h2>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="pill">{children}</span>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function aggregateLocations(rows: InventoryRow[]) {
  const byLocation: Record<string, number> = {};
  rows.forEach((row) => {
    byLocation[row.location] = (byLocation[row.location] ?? 0) + row.quantity;
  });
  return Object.entries(byLocation).sort((a, b) => b[1] - a[1]);
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string>('로그인 필요');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stock, setStock] = useState<InventoryRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [movement, setMovement] = useState<MovementPayload>(EMPTY_MOVEMENT);
  const [stockFilters, setStockFilters] = useState({ search: '', category: '', location: '' });
  const [historyFilters, setHistoryFilters] = useState({ search: '', direction: '' });

  async function login() {
    setStatus('로그인 중...');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      setStatus('로그인 완료');
      await refresh();
    } else {
      const text = await res.text();
      setStatus(`로그인 실패: ${text || res.status}`);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setStatus('로그아웃됨');
  }

  async function refresh() {
    setIsLoading(true);
    try {
      const [stockRes, histRes] = await Promise.all([fetch('/api/inventory'), fetch('/api/history')]);
      if (stockRes.ok) setStock(await stockRes.json());
      if (histRes.ok) setHistory(await histRes.json());
      setStatus('데이터 동기화 완료');
    } catch (err) {
      setStatus('데이터 불러오기 실패');
    } finally {
      setIsLoading(false);
    }
  }

  async function submitMovement() {
    setIsSubmitting(true);
    setStatus('처리 중...');
    const payload = { ...movement, quantity: Number(movement.quantity) };
    const res = await fetch('/api/movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      setStatus('기록 완료');
      setMovement(EMPTY_MOVEMENT);
      await refresh();
    } else {
      const text = await res.text();
      setStatus(`기록 실패: ${text || res.status}`);
    }
    setIsSubmitting(false);
  }

  function generateKey() {
    const key = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMovement((prev) => ({ ...prev, idempotencyKey: key }));
  }

  const filteredStock = useMemo(() => {
    return stock.filter((row) => {
      const matchesSearch = [row.artist, row.album_version, row.option, row.location]
        .join(' ')
        .toLowerCase()
        .includes(stockFilters.search.toLowerCase());
      const matchesCategory = !stockFilters.category || row.category === stockFilters.category;
      const matchesLocation = !stockFilters.location || row.location.includes(stockFilters.location);
      return matchesSearch && matchesCategory && matchesLocation;
    });
  }, [stock, stockFilters]);

  const filteredHistory = useMemo(() => {
    return history.filter((row) => {
      const matchesDirection = !historyFilters.direction || row.direction === historyFilters.direction;
      const matchesSearch = [
        row.artist,
        row.album_version,
        row.option,
        row.location,
        row.created_by,
        row.memo ?? ''
      ]
        .join(' ')
        .toLowerCase()
        .includes(historyFilters.search.toLowerCase());
      return matchesDirection && matchesSearch;
    });
  }, [history, historyFilters]);

  const totalQuantity = useMemo(
    () => filteredStock.reduce((sum, row) => sum + row.quantity, 0),
    [filteredStock]
  );
  const distinctItems = useMemo(
    () => new Set(filteredStock.map((r) => `${r.artist}|${r.category}|${r.album_version}|${r.option}`)).size,
    [filteredStock]
  );
  const locationBreakdown = useMemo(() => aggregateLocations(filteredStock), [filteredStock]);

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">재고 관리 대시보드</p>
          <h1>웹 재고관리 · Python 데스크톱과 동일한 흐름</h1>
          <p className="muted">로그인 → 입/출고 → 재고/이력 조회 → CSV 내보내기 순서를 한 화면에서 제공합니다.</p>
        </div>
        <div className="status-panel">
          <div className="status-row">
            <span className="status-dot" aria-hidden />
            <span>{status}</span>
          </div>
          <div className="status-row">{isLoading ? '동기화 중...' : '대기'}</div>
          <button className="ghost" onClick={refresh}>새로고침</button>
        </div>
      </header>

      <Section
        title="로그인"
        actions={<button className="secondary" onClick={logout}>로그아웃</button>}
      >
        <div className="form-grid two">
          <label>
            <span>이메일</span>
            <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <span>비밀번호</span>
            <input
type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="actions-row">
            <button onClick={login}>로그인</button>
            <button className="ghost" onClick={refresh}>세션 확인</button>
          </div>
        </div>
      </Section>

      <Section
        title="입/출고 등록"
        actions={
          <div className="section-actions">
            <button className="ghost" onClick={generateKey}>중복 방지 키 생성</button>
            <button className="ghost" onClick={() => setMovement(EMPTY_MOVEMENT)}>입력값 초기화</button>
          </div>
        }
      >
        <div className="form-grid three">
          <label>
            <span>아티스트</span>
            <input
              value={movement.artist}
              onChange={(e) => setMovement({ ...movement, artist: e.target.value })}
              placeholder="예: ARTIST"
            />
          </label>
          <label>
            <span>카테고리</span>
            <select
              value={movement.category}
              onChange={(e) => setMovement({ ...movement, category: e.target.value as MovementPayload['category'] })}
            >
              <option value="album">앨범</option>
              <option value="md">MD</option>
            </select>
          </label>
          <label>
            <span>앨범/버전</span>
            <input
              value={movement.album_version}
              onChange={(e) => setMovement({ ...movement, album_version: e.target.value })}
              placeholder="앨범명/버전"
            />
          </label>
          <label>
            <span>옵션</span>
            <input
              value={movement.option}
              onChange={(e) => setMovement({ ...movement, option: e.target.value })}
              placeholder="포카/키트 등"
            />
          </label>
          <label>
            <span>로케이션</span>
            <input
              value={movement.location}
              onChange={(e) => setMovement({ ...movement, location: e.target.value })}
              placeholder="창고/선반"
            />
          </label>
          <label>
            <span>수량</span>
            <input
type="number"
              value={movement.quantity}
              onChange={(e) => setMovement({ ...movement, quantity: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>유형</span>
            <select
              value={movement.direction}
              onChange={(e) => setMovement({ ...movement, direction: e.target.value as MovementPayload['direction'] })}
            >
              <option value="IN">입고</option>
              <option value="OUT">출고</option>
              <option value="ADJUST">재고조정</option>
            </select>
          </label>
          <label className="wide">
            <span>메모</span>
            <input
              value={movement.memo}
              onChange={(e) => setMovement({ ...movement, memo: e.target.value })}
              placeholder="작업 사유/비고"
            />
          </label>
          <label className="wide">
            <span>Idempotency Key</span>
            <input
              value={movement.idempotencyKey}
              onChange={(e) => setMovement({ ...movement, idempotencyKey: e.target.value })}
              placeholder="중복 방지 키"
            />
          </label>
        </div>
        <div className="actions-row">
          <button disabled={isSubmitting} onClick={submitMovement}>
            {isSubmitting ? '처리 중...' : '입/출고 기록'}
          </button>
          <p className="muted">
            Python GUI의 흐름처럼 필수 정보 입력 → 유형 선택 → 기록 버튼을 누르면 이력/재고가 실시간 반영됩니다.
          </p>
        </div>
      </Section>

      <Section
        title="현재 재고"
        actions={
          <div className="section-actions">
            <input
              className="inline-input"
              placeholder="검색 (아티스트/버전/옵션/위치)"
              value={stockFilters.search}
              onChange={(e) => setStockFilters({ ...stockFilters, search: e.target.value })}
            />
            <select
              value={stockFilters.category}
              onChange={(e) => setStockFilters({ ...stockFilters, category: e.target.value })}
            >
              <option value="">전체</option>
              <option value="album">앨범</option>
              <option value="md">MD</option>
            </select>
            <input
              className="inline-input"
              placeholder="로케이션 필터"
              value={stockFilters.location}
              onChange={(e) => setStockFilters({ ...stockFilters, location: e.target.value })}
            />
            <a className="ghost" href="/api/export?type=inventory">CSV 내보내기</a>
          </div>
        }
      >
        <div className="stats">
          <div className="stat">
            <p className="eyebrow">재고 수량</p>
            <h3>{totalQuantity.toLocaleString()}</h3>
            <p className="muted">전체 로케이션 합계</p>
          </div>
          <div className="stat">
            <p className="eyebrow">고유 품목</p>
            <h3>{distinctItems.toLocaleString()}</h3>
            <p className="muted">아티스트/버전/옵션 기준</p>
          </div>
          <div className="stat">
            <p className="eyebrow">로케이션 분포</p>
            <div className="pill-row">
              {locationBreakdown.slice(0, 4).map(([loc, qty]) => (
                <Pill key={loc}>
                  {loc}: {qty.toLocaleString()}
                </Pill>
              ))}
            </div>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>아티스트</th>
                <th>카테고리</th>
                <th>앨범/버전</th>
                <th>옵션</th>
                <th>로케이션</th>
                <th style={{ textAlign: 'right' }}>현재고</th>
              </tr>
            </thead>
            <tbody>
              {filteredStock.map((row) => (
                <tr key={`${row.artist}-${row.album_version}-${row.option}-${row.location}`}>
                  <td>{row.artist}</td>
                  <td>{row.category}</td>
                  <td>{row.album_version}</td>
                  <td>{row.option}</td>
                  <td>{row.location}</td>
                  <td style={{ textAlign: 'right' }}>{row.quantity.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="입출고 이력"
        actions={
          <div className="section-actions">
            <input
              className="inline-input"
              placeholder="검색 (품목/위치/담당/메모)"
              value={historyFilters.search}
              onChange={(e) => setHistoryFilters({ ...historyFilters, search: e.target.value })}
            />
            <select
              value={historyFilters.direction}
              onChange={(e) => setHistoryFilters({ ...historyFilters, direction: e.target.value })}
            >
              <option value="">전체</option>
              <option value="IN">입고</option>
              <option value="OUT">출고</option>
              <option value="ADJUST">조정</option>
            </select>
            <a className="ghost" href="/api/export?type=history">CSV 내보내기</a>
          </div>
        }
      >
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>일시</th>
                <th>유형</th>
                <th>아티스트</th>
                <th>카테고리</th>
                <th>앨범/버전</th>
                <th>옵션</th>
                <th>로케이션</th>
                <th style={{ textAlign: 'right' }}>수량</th>
                <th>담당</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((h, idx) => (
                <tr key={`${h.created_at}-${idx}`}>
                  <td>{formatDate(h.created_at)}</td>
                  <td>
                    <Pill>{h.direction}</Pill>
                  </td>
                  <td>{h.artist}</td>
                  <td>{h.category}</td>
                  <td>{h.album_version}</td>
                  <td>{h.option}</td>
                  <td>{h.location}</td>
                  <td style={{ textAlign: 'right' }}>{h.quantity.toLocaleString()}</td>
                  <td>{h.created_by}</td>
                  <td>{h.memo || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}
