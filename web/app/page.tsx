'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type InventoryRow = {
  id: string;
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

type AdminLog = {
  id: string;
  action: string;
  detail: string | null;
  actor_email: string | null;
  actor_id: string | null;
  created_at: string;
};

type MovementPayload = {
  artist: string;
  category: 'album' | 'md';
  album_version: string;
  option: string;
  location: string;
  quantity: number;
  direction: 'IN' | 'OUT' | 'ADJUST';
  memo: string;
};

type Role = 'admin' | 'operator' | 'viewer';

const EMPTY_MOVEMENT: MovementPayload = {
  artist: '',
  category: 'album',
  album_version: '',
  option: '',
  location: '',
  quantity: 0,
  direction: 'IN',
  memo: ''
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
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
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
  const [selectedStockId, setSelectedStockId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InventoryRow | null>(null);
  const [activePanel, setActivePanel] = useState<'stock' | 'history' | 'admin'>('stock');
  const [stockFilters, setStockFilters] = useState({ search: '', category: '', location: '', artist: '' });
  const [locationPresets, setLocationPresets] = useState<string[]>([]);
  const today = useMemo(() => new Date(), []);
  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);
  const [historyFilters, setHistoryFilters] = useState({
    search: '',
    direction: '',
    from: sevenDaysAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10)
  });
  const [newUser, setNewUser] = useState<{ email: string; password: string; role: Role }>({
    email: '',
    password: '',
    role: 'operator'
  });
  const [adminStatus, setAdminStatus] = useState('');
  const [sessionRole, setSessionRole] = useState<Role | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
  const [newLocation, setNewLocation] = useState('');
  const [createUserStatus, setCreateUserStatus] = useState('');
  const [inventoryActionStatus, setInventoryActionStatus] = useState('');
  const logoutTimeout = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function fetchSessionInfo() {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      setSessionRole(null);
      setSessionEmail(null);
      setShowAdmin(false);
      setSessionExpiry(null);
      return null;
    }
    const data = await res.json();
    if (!data.authenticated) {
      setSessionRole(null);
      setSessionEmail(null);
      setShowAdmin(false);
      setSessionExpiry(null);
      return null;
    }
    setSessionRole(data.role ?? null);
    setSessionEmail(data.email ?? null);
    setSessionExpiry(data.expiresAt ?? null);
    await fetchLocations();
    return data;
  }

  async function fetchLocations() {
    try {
      const res = await fetch('/api/admin/locations');
      if (res.ok) {
        const data = await res.json();
        setLocationPresets(data || []);
      }
    } catch (err) {
      // ignore silently
    }
  }

  async function loadAdminLogs() {
    setLogStatus('로그 불러오는 중...');
    const res = await fetch('/api/admin/logs');
    if (res.ok) {
      setAdminLogs(await res.json());
      setLogStatus('');
    } else {
      setLogStatus('로그 불러오기 실패');
    }
  }

  async function uploadInventoryFromFile() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setImportStatus('JSON/엑셀 파일을 선택하세요');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setImportStatus('업로드 중...');

    const res = await fetch('/api/admin/import', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      setImportStatus(`업로드 완료: 재고 ${data.stockCount}건, 이력 ${data.historyCount}건`);
      await refresh();
      await fetchLocations();
      await loadAdminLogs();
    } else {
      const text = await res.text();
      setImportStatus(`실패: ${text || res.status}`);
    }
  }

  async function addLocationPreset() {
    if (!newLocation.trim()) {
      setAdminStatus('로케이션 이름을 입력하세요');
      return;
    }

    setAdminStatus('로케이션 저장 중...');
    const res = await fetch('/api/admin/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newLocation }),
    });

    if (res.ok) {
      setLocationPresets(await res.json());
      setNewLocation('');
      setAdminStatus('로케이션 저장 완료');
    } else {
      const text = await res.text();
      setAdminStatus(`저장 실패: ${text || res.status}`);
    }
  }

  async function removeLocationPreset(name: string) {
    setAdminStatus('로케이션 삭제 중...');
    const res = await fetch('/api/admin/locations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (res.ok) {
      setLocationPresets(await res.json());
      setAdminStatus('삭제 완료');
    } else {
      const text = await res.text();
      setAdminStatus(`삭제 실패: ${text || res.status}`);
    }
  }

  async function login() {
    setStatus('로그인 중...');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      setStatus('로그인 완료');
      const sessionInfo = await fetchSessionInfo();
      if (sessionInfo?.role === 'admin') {
        await loadAdminLogs();
      }
      await refresh();
    } else {
      const text = await res.text();
      setStatus(`로그인 실패: ${text || res.status}`);
    }
  }

  async function logout(reason?: 'expired') {
    await fetch('/api/auth/logout', { method: 'POST' });
    setStatus(reason === 'expired' ? '세션 만료' : '로그아웃됨');
    setSessionRole(null);
    setSessionEmail(null);
    setSessionExpiry(null);
    setShowAdmin(false);
    setStock([]);
    setHistory([]);
    setAdminLogs([]);
    setLocationPresets([]);
    setSelectedStockId(null);
    if (logoutTimeout.current) {
      clearTimeout(logoutTimeout.current);
      logoutTimeout.current = null;
    }
  }

  const isLoggedIn = Boolean(sessionEmail);

  async function handleAuthToggle() {
    if (isLoggedIn) {
      await logout();
    } else {
      await login();
    }
  }

  async function handleAutoLogout() {
    await logout('expired');
    alert('로그인 후 30분이 지나 자동 로그아웃되었습니다. 다시 로그인하세요.');
  }

  async function refresh() {
    setIsLoading(true);
    try {
      const [stockRes, histRes] = await Promise.all([fetch('/api/inventory'), fetch('/api/history')]);
      if (stockRes.ok) setStock(await stockRes.json());
      if (histRes.ok) setHistory(await histRes.json());
      setStatus('데이터 동기화 완료');
      setSelectedStockId(null);
      setEditDraft(null);
    } catch (err) {
      setStatus('데이터 불러오기 실패');
    } finally {
      setIsLoading(false);
    }
  }

  async function submitMovement(
    event: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>,
    direction: MovementPayload['direction']
  ) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus('처리 중...');

    const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `web-${(crypto as any).randomUUID()}`
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
      artist: movement.artist,
      category: movement.category,
      album_version: movement.album_version,
      option: movement.option,
      location: movement.location,
      quantity: Number(movement.quantity),
      direction,
      memo: movement.memo,
      idempotency_key: idempotencyKey
    };

    try {
      const res = await fetch('/api/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);

      if (res.ok && (data?.ok ?? true)) {
        setStatus('기록 완료');
        setMovement((prev) => ({ ...EMPTY_MOVEMENT, direction: prev.direction }));
        await refresh();
      } else {
        const errorMessage = data?.error || res.statusText || '요청 실패';
        setStatus(`기록 실패: ${errorMessage}`);
        alert(errorMessage);
      }
    } catch (err: any) {
      const message = err?.message || '요청 중 오류가 발생했습니다.';
      setStatus(`기록 실패: ${message}`);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createUser() {
    setCreateUserStatus('계정 생성 중...');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    if (res.ok) {
      setCreateUserStatus('새 계정 생성 완료');
      setNewUser({ email: '', password: '', role: 'operator' });
    } else {
      const text = await res.text();
      setCreateUserStatus(`생성 실패: ${text || res.status}`);
    }
  }

  function handleStockClick(row: InventoryRow) {
    setSelectedStockId((prev) => (prev === row.id ? null : row.id));
  }

  function handleStockDoubleClick(row: InventoryRow) {
    setSelectedStockId(row.id);
    const hasMultipleLocations = stock.some(
      (r) =>
        r.artist === row.artist &&
        r.category === row.category &&
        r.album_version === row.album_version &&
        r.option === row.option &&
        r.location !== row.location
    );

    setMovement((prev) => ({
      ...prev,
      artist: row.artist,
      category: row.category as MovementPayload['category'],
      album_version: row.album_version,
      option: row.option,
      location: hasMultipleLocations ? '' : row.location,
      quantity: 0,
    }));

    setStatus(
      hasMultipleLocations
        ? '복수 로케이션 보유: 위치를 직접 선택하세요'
        : '선택한 재고를 입/출고 입력에 불러왔습니다'
    );
  }

  async function saveInventoryEdit() {
    if (!editDraft) return;
    setInventoryActionStatus('재고 수정 중...');
    const res = await fetch(`/api/inventory/${editDraft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editDraft),
    });

    if (res.ok) {
      setInventoryActionStatus('수정 완료');
      await refresh();
    } else {
      const text = await res.text();
      setInventoryActionStatus(`수정 실패: ${text || res.status}`);
      alert(text || '수정 실패');
    }
  }

  async function deleteInventoryRow(target?: InventoryRow) {
    const row = target ?? editDraft;
    if (!row) return;
    if (!confirm('선택한 재고를 삭제하시겠습니까?')) return;
    setInventoryActionStatus('삭제 중...');
    const res = await fetch(`/api/inventory/${row.id}`, { method: 'DELETE' });
    if (res.ok) {
      setInventoryActionStatus('삭제 완료');
      setSelectedStockId(null);
      await refresh();
    } else {
      const text = await res.text();
      setInventoryActionStatus(`삭제 실패: ${text || res.status}`);
      alert(text || '삭제 실패');
    }
  }

  const filteredStock = useMemo(() => {
    return stock.filter((row) => {
      const matchesSearch = [row.artist, row.album_version, row.option, row.location]
        .join(' ')
        .toLowerCase()
        .includes(stockFilters.search.toLowerCase());
      const matchesCategory = !stockFilters.category || row.category === stockFilters.category;
      const matchesLocation = !stockFilters.location || row.location === stockFilters.location;
      const matchesArtist = !stockFilters.artist || row.artist === stockFilters.artist;
      return matchesSearch && matchesCategory && matchesLocation && matchesArtist;
    });
  }, [stock, stockFilters]);

  const stockLocations = useMemo(
    () => Array.from(new Set(stock.map((row) => row.location))).filter(Boolean).sort(),
    [stock]
  );

  const locationOptions = useMemo(
    () => Array.from(new Set([...locationPresets, ...stockLocations])).filter(Boolean).sort(),
    [locationPresets, stockLocations]
  );

  const filterLocationOptions = useMemo(() => stockLocations, [stockLocations]);

  const artistOptions = useMemo(
    () => Array.from(new Set(stock.map((row) => row.artist))).filter(Boolean).sort(),
    [stock]
  );

  const filteredHistory = useMemo(() => {
    const fromDate = historyFilters.from ? new Date(historyFilters.from) : null;
    const toDate = historyFilters.to ? new Date(`${historyFilters.to}T23:59:59`) : null;
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
      const created = new Date(row.created_at);
      const matchesFrom = !fromDate || created >= fromDate;
      const matchesTo = !toDate || created <= toDate;
      return matchesDirection && matchesSearch && matchesFrom && matchesTo;
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
    if (logoutTimeout.current) {
      clearTimeout(logoutTimeout.current);
      logoutTimeout.current = null;
    }

    if (!sessionExpiry || !isLoggedIn) return;

    const remaining = sessionExpiry - Date.now();
    if (remaining <= 0) {
      handleAutoLogout();
      return;
    }

    logoutTimeout.current = setTimeout(handleAutoLogout, remaining);

    return () => {
      if (logoutTimeout.current) {
        clearTimeout(logoutTimeout.current);
        logoutTimeout.current = null;
      }
    };
  }, [sessionExpiry, isLoggedIn]);

  useEffect(() => {
    if (showAdmin && sessionRole === 'admin') {
      loadAdminLogs();
    }
  }, [showAdmin, sessionRole]);

  useEffect(() => {
    setShowAdmin(activePanel === 'admin' && sessionRole === 'admin');
  }, [activePanel, sessionRole]);

  useEffect(() => {
    if ((activePanel === 'history' && history.length === 0) || (activePanel === 'stock' && stock.length === 0)) {
      refresh();
    }
  }, [activePanel, history.length, stock.length]);

  useEffect(() => {
    if (!selectedStockId) {
      setEditDraft(null);
      return;
    }
    const match = stock.find((row) => row.id === selectedStockId);
    setEditDraft(match ?? null);
  }, [selectedStockId, stock]);

  useEffect(() => {
    setInventoryActionStatus('');
  }, [selectedStockId]);

  useEffect(() => {
    fetchSessionInfo();
    refresh();
  }, []);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">재고 관리 대시보드</p>
          <p className="muted">Python 데스크톱에서 쓰던 순서를 그대로: 로그인 → 입/출고 입력 → 재고/이력 확인 → CSV 다운로드.</p>
          <p className="muted">상단 탭에서 현재 재고 · 입출고 이력 · 관리자 페이지를 전환하세요.</p>
        </div>
        <div className="status-panel">
          <div className="status-row">
            <span className="status-dot" aria-hidden />
            <span>{status}</span>
          </div>
          <div className="status-row">{isLoading ? '동기화 중...' : '대기'}</div>
          {sessionEmail && (
            <div className="status-row">{sessionEmail} ({sessionRole})</div>
          )}
          <button className="ghost" onClick={refresh}>새로고침</button>
        </div>
      </header>

      <div className="tab-row">
        <button
          className={activePanel === 'stock' ? 'tab active' : 'tab'}
          onClick={() => setActivePanel('stock')}
        >
          현재 재고
        </button>
        <button
          className={activePanel === 'history' ? 'tab active' : 'tab'}
          onClick={() => setActivePanel('history')}
        >
          입출고 이력
        </button>
        <button
          className={activePanel === 'admin' ? 'tab active' : 'tab'}
          onClick={() => setActivePanel('admin')}
          disabled={sessionRole !== 'admin'}
          title={sessionRole === 'admin' ? undefined : '관리자 로그인 필요'}
        >
          관리자 페이지
        </button>
      </div>

      <Section title="로그인">
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
            <button onClick={handleAuthToggle}>{isLoggedIn ? '로그아웃' : '로그인'}</button>
            <button className="ghost" onClick={refresh}>세션 확인</button>
          </div>
        </div>
      </Section>

      {activePanel === 'admin' && showAdmin && (
        <Section
          title="관리자 도구"
          actions={<Pill>admin 전용</Pill>}
        >
          <div className="guide-grid">
            <div className="guide-card">
              <p className="mini-label">레거시 데이터 이관</p>
              <ul>
                <li>`inventory_data.json`을 최신으로 준비합니다.</li>
                <li>Supabase SQL Editor에서 `supabase/schema.sql` 실행 후 비워진 테이블을 생성합니다.</li>
                <li>`scripts/migrate_json.py`를 실행해 JSON 재고를 Supabase로 업서트합니다.</li>
                <li>완료 후 아래 새로고침 → 재고/이력 테이블에서 반영 여부를 확인합니다.</li>
              </ul>
            </div>
            <div className="guide-card">
              <p className="mini-label">신규 계정 발급</p>
              <p className="muted">관리자가 직접 이메일/비밀번호/권한을 생성합니다.</p>
              <div className="form-grid two">
                <label>
                  <span>이메일</span>
                  <input
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="user@example.com"
                  />
                </label>
                <label>
                  <span>비밀번호</span>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="8자 이상"
                  />
                </label>
                <label>
                  <span>역할</span>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as Role })}
                  >
                    <option value="admin">admin (전체 권한)</option>
                    <option value="operator">operator (입/출고)</option>
                    <option value="viewer">viewer (조회 전용)</option>
                  </select>
                </label>
              </div>
              <div className="actions-row">
                <button onClick={createUser}>계정 생성</button>
                <span className="muted">{createUserStatus || '로그인한 admin만 실행 가능'}</span>
              </div>
            </div>
            <div className="guide-card">
              <p className="mini-label">작업 순서 요약</p>
              <ol className="muted">
                <li>관리자 계정으로 로그인 후 세션 확인</li>
                <li>필요시 위에서 신규 계정 발급</li>
                <li>입/출고 기록 → 재고/이력/CSV로 검증</li>
              </ol>
            </div>
            <div className="guide-card">
              <p className="mini-label">로케이션 사전 설정</p>
              <p className="muted">관리자가 정한 창고/선반 목록을 입력하면 입/출고 입력창에서 바로 선택 가능합니다.</p>
              <div className="form-grid two">
                <label>
                  <span>로케이션 이름</span>
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="예: B-1 선반"
                  />
                </label>
                <div className="actions-row">
                  <button onClick={addLocationPreset}>추가/업서트</button>
                  <span className="muted">{adminStatus || 'admin만 수정 가능'}</span>
                </div>
              </div>
              <div className="pill-row scrollable">
                {locationPresets.length === 0 && <span className="muted">등록된 로케이션이 없습니다.</span>}
                {locationPresets.map((loc) => (
                  <span key={loc} className="pill">
                    {loc}
                    <button className="chip-close" onClick={() => removeLocationPreset(loc)} aria-label={`${loc} 삭제`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="guide-card">
              <p className="mini-label">재고/이력 업로드 (JSON 또는 엑셀)</p>
              <p className="muted">엑셀 첫 번째 시트는 재고(artist, category, album_version, option, location, quantity), 두 번째 시트는 이력(direction, quantity, memo, timestamp) 형식으로 채워 업로드하세요.</p>
              <ul className="muted">
                <li>시트1 재고: artist, category(album/md), album_version, option, location, quantity/current_stock</li>
                <li>시트2 이력(선택): artist, category, album_version, option, location, direction(IN/OUT/ADJUST), quantity, memo, timestamp</li>
              </ul>
              <input type="file" accept=".json,.xlsx,.xls" ref={fileInputRef} />
              <div className="actions-row">
                <button onClick={uploadInventoryFromFile}>업로드</button>
                <span className="muted">{importStatus || 'JSON/엑셀 파일 선택 후 실행'}</span>
              </div>
            </div>
            <div className="guide-card full-span">
              <div className="section-heading" style={{ marginBottom: '0.5rem' }}>
                <div>
                  <p className="mini-label">관리자 로그</p>
                  <p className="muted">계정 생성, 업로드, 로케이션 변경 이력 등 관리 작업을 확인합니다.</p>
                </div>
                <div className="actions-row">
                  <button className="ghost" onClick={loadAdminLogs}>새로고침</button>
                  <span className="muted">{logStatus || ''}</span>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="table compact-table">
                  <thead>
                    <tr>
                      <th>일시</th>
                      <th>작업</th>
                      <th>세부 정보</th>
                      <th>실행자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminLogs.length === 0 && (
                      <tr>
                        <td colSpan={4}>로그가 없습니다. 새로고침을 눌러 확인하세요.</td>
                      </tr>
                    )}
                    {adminLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{formatDate(log.created_at)}</td>
                        <td>{log.action}</td>
                        <td>{log.detail || '-'}</td>
                        <td>{log.actor_email || log.actor_id || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Section>
      )}

      {activePanel === 'stock' && (
        <>
          <Section
            title="입/출고 등록"
            actions={
              <div className="section-actions">
                <button className="ghost" onClick={() => setMovement(EMPTY_MOVEMENT)}>입력값 초기화</button>
              </div>
            }
          >
            <form onSubmit={(e) => submitMovement(e, movement.direction)}>
              <div className="form-row">
                <label>
                  <span>아티스트</span>
                  <input
                    value={movement.artist}
                    onChange={(e) => setMovement({ ...movement, artist: e.target.value })}
                    placeholder="예: ARTIST"
                  />
                </label>
                <label className="compact">
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
                    list="location-options"
                    value={movement.location}
                    onChange={(e) => setMovement({ ...movement, location: e.target.value })}
                    placeholder="창고/선반"
                  />
                  <datalist id="location-options">
                    {locationOptions.map((loc) => (
                      <option key={loc} value={loc} />
                    ))}
                  </datalist>
                </label>
                <label className="compact">
                  <span>수량</span>
                  <input
                    type="number"
                    value={movement.quantity}
                    onChange={(e) => setMovement({ ...movement, quantity: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="wide">
                  <span>메모</span>
                  <input
                    value={movement.memo}
                    onChange={(e) => setMovement({ ...movement, memo: e.target.value })}
                    placeholder="작업 사유/비고"
                  />
                </label>
              </div>
              <div className="actions-row">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={(e) => submitMovement(e, 'IN')}
                >
                  {isSubmitting ? '처리 중...' : '입고'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  className="secondary"
                  onClick={(e) => submitMovement(e, 'OUT')}
                >
                  {isSubmitting ? '처리 중...' : '출고'}
                </button>
                <p className="muted">입고/출고를 버튼으로 나눠 Python GUI와 동일한 동선을 제공합니다.</p>
              </div>
            </form>
          </Section>

          <Section
            title="현재 재고"
            actions={
              <div className="filter-row">
                <input
                  className="inline-input"
                  placeholder="검색 (아티스트/버전/옵션/위치)"
                  value={stockFilters.search}
                  onChange={(e) => setStockFilters({ ...stockFilters, search: e.target.value })}
                />
                <select
                  className="scroll-select"
                  value={stockFilters.artist}
                  onChange={(e) => setStockFilters({ ...stockFilters, artist: e.target.value })}
                >
                  <option value="">전체 아티스트</option>
                  {artistOptions.map((artist) => (
                    <option key={artist} value={artist}>
                      {artist}
                    </option>
                  ))}
                </select>
                <select
                  className="scroll-select"
                  value={stockFilters.location}
                  onChange={(e) => setStockFilters({ ...stockFilters, location: e.target.value })}
                >
                  <option value="">전체 로케이션</option>
                  {filterLocationOptions.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
                <select
                  className="compact"
                  value={stockFilters.category}
                  onChange={(e) => setStockFilters({ ...stockFilters, category: e.target.value })}
                >
                  <option value="">전체</option>
                  <option value="album">앨범</option>
                  <option value="md">MD</option>
                </select>
                <a className="ghost button-link" href="/api/export?type=inventory">CSV 내보내기</a>
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
                <th className="align-right">현재고</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredStock.map((row) => (
                <tr
                  key={row.id}
                  className={selectedStockId === row.id ? 'selected-row' : ''}
                  onClick={() => handleStockClick(row)}
                  onDoubleClick={() => handleStockDoubleClick(row)}
                >
                  <td>{row.artist}</td>
                  <td>{row.category}</td>
                  <td>{row.album_version}</td>
                  <td>{row.option}</td>
                  <td>{row.location}</td>
                  <td className="align-right">{row.quantity.toLocaleString()}</td>
                  <td>
                    {sessionRole === 'viewer' ? (
                      <span className="muted">읽기 전용</span>
                    ) : (
                      <div className="row-actions">
                        <button
                          className="ghost small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStockId(row.id);
                          }}
                        >
                          선택
                        </button>
                        <button
                          className="ghost danger small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStockId(row.id);
                            setEditDraft(row);
                            deleteInventoryRow(row);
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sessionRole !== 'viewer' && editDraft && (
          <div className="inline-editor">
            <div className="section-heading" style={{ marginBottom: '0.5rem' }}>
              <h3>선택 재고 편집</h3>
              <span className="muted">더블클릭으로 입력창 자동 채우기 · 저장 후 새로고침</span>
            </div>
            <div className="form-row">
              <label>
                <span>아티스트</span>
                <input
                  value={editDraft.artist}
                  onChange={(e) => setEditDraft({ ...editDraft, artist: e.target.value })}
                />
              </label>
              <label className="compact">
                <span>카테고리</span>
                <select
                  value={editDraft.category}
                  onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
                >
                  <option value="album">앨범</option>
                  <option value="md">MD</option>
                </select>
              </label>
              <label>
                <span>앨범/버전</span>
                <input
                  value={editDraft.album_version}
                  onChange={(e) => setEditDraft({ ...editDraft, album_version: e.target.value })}
                />
              </label>
              <label>
                <span>옵션</span>
                <input
                  value={editDraft.option}
                  onChange={(e) => setEditDraft({ ...editDraft, option: e.target.value })}
                />
              </label>
              <label>
                <span>로케이션</span>
                <input
                  value={editDraft.location}
                  onChange={(e) => setEditDraft({ ...editDraft, location: e.target.value })}
                />
              </label>
              <label className="compact">
                <span>수량</span>
                <input
                  type="number"
                  value={editDraft.quantity}
                  onChange={(e) => setEditDraft({ ...editDraft, quantity: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="actions-row">
              <button onClick={saveInventoryEdit}>수정 저장</button>
              <button className="ghost danger" onClick={() => deleteInventoryRow(editDraft)}>삭제</button>
              <span className="muted">{inventoryActionStatus || '선택 행만 operator/admin 수정 가능'}</span>
            </div>
          </div>
        )}
      </Section>
        </>
      )}

      {activePanel === 'history' && (
      <Section
        title="입출고 이력"
        actions={
          <div className="filter-row">
            <input
              className="inline-input"
              placeholder="검색 (품목/위치/담당/메모)"
              value={historyFilters.search}
              onChange={(e) => setHistoryFilters({ ...historyFilters, search: e.target.value })}
            />
            <select
              className="compact"
              value={historyFilters.direction}
              onChange={(e) => setHistoryFilters({ ...historyFilters, direction: e.target.value })}
            >
              <option value="">전체 유형</option>
              <option value="IN">입고</option>
              <option value="OUT">출고</option>
              <option value="ADJUST">조정</option>
            </select>
            <label className="compact date-label">
              <span>시작</span>
              <input
                type="date"
                value={historyFilters.from}
                onChange={(e) => setHistoryFilters({ ...historyFilters, from: e.target.value })}
              />
            </label>
            <label className="compact date-label">
              <span>종료</span>
              <input
                type="date"
                value={historyFilters.to}
                onChange={(e) => setHistoryFilters({ ...historyFilters, to: e.target.value })}
              />
            </label>
            <a className="ghost button-link" href="/api/export?type=history">CSV 내보내기</a>
          </div>
        }
      >
        <p className="muted" style={{ margin: '0 0 0.5rem' }}>
          기본적으로 최근 7일 데이터를 보여주며, 달력으로 기간을 직접 선택하고 유형으로 필터링할 수 있습니다.
        </p>
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
                <th className="align-right">수량</th>
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
                  <td className="align-right">{h.quantity.toLocaleString()}</td>
                  <td>{h.created_by}</td>
                  <td>{h.memo || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      )}
    </main>
  );
}
