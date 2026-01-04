'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';

type InventoryLocation = {
  id: string;
  location: string;
  quantity: number;
};

type InventoryRow = {
  key: string;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  total_quantity: number;
  locations: InventoryLocation[];
};

type InventoryEditDraft = InventoryLocation & Omit<InventoryRow, 'locations' | 'total_quantity' | 'key'>;

type HistoryRow = {
  created_at: string;
  direction: 'IN' | 'OUT' | 'ADJUST';
  artist: string;
  category: string;
  album_version: string;
  option?: string;
  location: string;
  quantity: number;
  created_by: string;
  created_by_name?: string;
  created_by_department?: string;
  memo?: string;
};

type AccountRow = {
  id: string;
  username: string;
  email: string;
  full_name: string;
  department: string;
  contact?: string;
  purpose?: string;
  role: Role;
  approved: boolean;
  created_at: string;
  requested_at?: string;
  approved_at?: string | null;
};

type MovementPayload = {
  artist: string;
  category: 'album' | 'md';
  album_version: string;
  option: string;
  location: string;
  quantity: number;
  direction: 'IN' | 'OUT';
  memo: string;
};

type Role = 'admin' | 'operator' | 'viewer';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity triggers logout
const CORPORATE_DOMAIN = 'sound-wave.co.kr';

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

function deriveStockKey(target?: InventoryRow | InventoryEditDraft | null) {
  if (!target) return null;
  return 'key' in target ? target.key : target.id;
}

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
    row.locations.forEach((loc) => {
      byLocation[loc.location] = (byLocation[loc.location] ?? 0) + loc.quantity;
    });
  });
  return Object.entries(byLocation).sort((a, b) => b[1] - a[1]);
}

export default function Home() {
  const normalizeUsername = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed) || trimmed.includes('@')) {
      throw new Error('ID에는 공백이나 @를 포함할 수 없습니다.');
    }
    return trimmed.toLowerCase();
  };

  const deriveEmail = (username: string) => `${username}@${CORPORATE_DOMAIN}`;

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [status, setStatus] = useState<string>('로그인 필요');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stock, setStock] = useState<InventoryRow[]>([]);
  const [showAnomalies, setShowAnomalies] = useState(false);
  const [editPanelEnabled, setEditPanelEnabled] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [movement, setMovement] = useState<MovementPayload>(EMPTY_MOVEMENT);
  const [selectedStockKeys, setSelectedStockKeys] = useState<string[]>([]);
  const [focusedStockKey, setFocusedStockKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InventoryEditDraft | null>(null);
  const [activePanel, setActivePanel] = useState<'stock' | 'history' | 'admin'>('stock');
  const [stockFilters, setStockFilters] = useState({ search: '', category: '', location: '', artist: '' });
  const [locationPresets, setLocationPresets] = useState<string[]>([]);
  const [registerForm, setRegisterForm] = useState({
    username: '',
    password: '',
    confirm: '',
    name: '',
    department: '',
    contact: '',
    purpose: '',
  });
  const today = useMemo(() => new Date(), []);
  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);
  const [historyFilters, setHistoryFilters] = useState({
    search: '',
    direction: '',
    category: '',
    from: sevenDaysAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10)
  });
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsStatus, setAccountsStatus] = useState('');
  const [registerStatus, setRegisterStatus] = useState('');
  const [adminStatus, setAdminStatus] = useState('');
  const [sessionRole, setSessionRole] = useState<Role | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [idleDeadline, setIdleDeadline] = useState<number | null>(null);
  const [pendingBlock, setPendingBlock] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [inventoryActionStatus, setInventoryActionStatus] = useState('');
  const logoutTimeout = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stockRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const adminRef = useRef<HTMLDivElement | null>(null);

  const notifyMissingSupabase = () => {
    const message = 'Supabase 환경 변수가 설정되지 않았습니다.';
    setStatus(message);
    alert(message);
  };

  const requireSupabase = () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      notifyMissingSupabase();
      return null;
    }
    return supabase;
  };

  const markActivity = () => {
    const next = Date.now() + IDLE_TIMEOUT_MS;
    setIdleDeadline(next);
  };

  const scrollToPanel = (panel: 'stock' | 'history' | 'admin') => {
    setActivePanel(panel);
    const target = panel === 'stock' ? stockRef.current : panel === 'history' ? historyRef.current : adminRef.current;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  async function fetchSessionInfo() {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      setSessionRole(null);
      setSessionEmail(null);
      setSessionUserId(null);
      setShowAdmin(false);
      setIdleDeadline(null);
      return null;
    }
    const data = await res.json();
    if (!data.authenticated) {
      setSessionRole(null);
      setSessionEmail(null);
      setSessionUserId(null);
      setShowAdmin(false);
      setIdleDeadline(null);
      return null;
    }
    if (data.approved === false) {
      setPendingBlock('관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.');
      await logout();
      return null;
    }
    setSessionRole(data.role ?? null);
    setSessionEmail(data.email ?? null);
    setSessionUserId(data.userId ?? null);
    markActivity();
    await fetchLocations();
    return data;
  }

  async function fetchLocations() {
    try {
      const res = await fetch('/api/admin/locations');
      if (res.ok) {
        const data = await res.json();
        setLocationPresets(data || []);
        if (data) {
          markActivity();
        }
      } else {
        setAdminStatus('로케이션 불러오기 실패');
      }
    } catch (err) {
      setAdminStatus('로케이션 불러오기 실패');
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
      markActivity();
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
      markActivity();
    } else {
      const text = await res.text();
      setAdminStatus(`삭제 실패: ${text || res.status}`);
    }
  }

  async function login() {
    try {
      const raw = loginUsername.trim();
      const normalized = raw.toLowerCase() === 'tksdlvkxl@gmail.com' ? raw : normalizeUsername(raw);
      if (!loginPassword) {
        setStatus('비밀번호를 입력하세요.');
        return;
      }
      setStatus('로그인 확인 중...');
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalized, password: loginPassword })
      });

      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        const message = body.error || '관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.';
        setPendingBlock(message);
        setStatus('승인 대기 중');
        const supabase = requireSupabase();
        if (supabase) {
          await supabase.auth.signOut();
        }
        return;
      }

      if (res.ok) {
        setStatus('로그인 완료');
        setLoginPassword('');
        markActivity();
        const sessionInfo = await fetchSessionInfo();
        await refresh();
      } else {
        const text = await res.text();
        setStatus(`로그인 실패: ${text || res.status}`);
      }
    } catch (err: any) {
      setStatus(err?.message || '로그인 실패');
    }
  }

  async function logout(reason?: 'expired') {
    await fetch('/api/auth/logout', { method: 'POST' });
    setStatus(reason === 'expired' ? '세션 만료' : '로그아웃됨');
    setSessionRole(null);
    setSessionEmail(null);
    setSessionUserId(null);
    setLoginPassword('');
    setIdleDeadline(null);
    setShowAdmin(false);
    setStock([]);
    setHistory([]);
    setLocationPresets([]);
    setSelectedStockKeys([]);
    setFocusedStockKey(null);
    setAccountManagerOpen(false);
    setAccounts([]);
    setAccountsStatus('');
    if (logoutTimeout.current) {
      clearTimeout(logoutTimeout.current);
      logoutTimeout.current = null;
    }
    const supabase = requireSupabase();
    if (supabase) {
      await supabase.auth.signOut();
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
    alert('30분 이상 사용 기록이 없어 자동 로그아웃되었습니다. 다시 로그인하세요.');
  }

  async function reloadInventory() {
    const stockRes = await fetch('/api/inventory', { cache: 'no-store' });
    if (stockRes.ok) {
      setStock(await stockRes.json());
    } else {
      setStatus('재고 불러오기 실패');
    }
  }

  async function reloadHistory() {
    const histRes = await fetch('/api/history', { cache: 'no-store' });
    if (histRes.ok) {
      const payload = await histRes.json();
      const rows = Array.isArray(payload)
        ? payload.map((row: any) => ({
            ...row,
            option: row.option ?? '',
            created_by_name: row.created_by_name ?? '',
          }))
        : [];
      setHistory(rows);
    } else {
      const payload = await histRes.json().catch(() => null);
      const message = payload?.error || payload?.message || '입출고 이력 불러오기 실패';
      setStatus(message);
      alert(message);
    }
  }

  async function refresh() {
    setIsLoading(true);
    try {
      await Promise.all([reloadInventory(), reloadHistory()]);
      setStatus('데이터 동기화 완료');
      setSelectedStockKeys([]);
      setFocusedStockKey(null);
      setEditDraft(null);
      markActivity();
    } catch (err) {
      setStatus('데이터 불러오기 실패');
    } finally {
      setIsLoading(false);
    }
  }

  async function submitMovement(direction: 'IN' | 'OUT') {
    const artistValue = movement.artist.trim();
    const albumVersion = movement.album_version.trim();
    const locationValue = movement.location.trim();
    const quantityValue = Number(movement.quantity);
    const memoValue = movement.memo.trim();
    const optionValue = movement.option;
    const categoryValue = movement.category;

    if (!artistValue || !albumVersion || !locationValue || !quantityValue) {
      alert('아티스트, 앨범/버전, 로케이션, 수량(1 이상)을 모두 입력해야 합니다.');
      return;
    }

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      alert('수량은 1 이상의 양수만 입력 가능합니다.');
      return;
    }

    if (direction === 'OUT' && !memoValue) {
      alert('출고 시 메모를 입력해야 합니다.');
      return;
    }

    setIsSubmitting(true);
    setStatus('처리 중...');
    markActivity();

    try {
      const idempotency_key = `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const res = await fetch('/api/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: artistValue,
          category: categoryValue,
          album_version: albumVersion,
          option: optionValue ?? '',
          location: locationValue,
          quantity: Number(quantityValue),
          direction,
          memo: memoValue ?? '',
          idempotency_key,
        })
      });

      const payload = await res.json().catch(() => null);
      const ok = payload?.ok === true;
      const duplicated = payload?.duplicated === true;

      if (!res.ok || !ok) {
        const message = payload?.error || payload?.message || `입출고 실패 (${res.status})`;
        const stepMessage = payload?.step ? `${message} [${payload.step}]` : message;
        console.error('movement submit error:', { message: stepMessage, payload });
        alert(stepMessage);
        setStatus(stepMessage);
        return;
      }

      await Promise.all([reloadInventory(), reloadHistory()]);
      setStatus(duplicated ? '중복 요청으로 기존 결과 유지' : '기록 완료');
      setMovement((prev) => ({ ...EMPTY_MOVEMENT, direction: prev.direction }));
    } catch (err: any) {
      const message = err?.message || '요청 중 오류가 발생했습니다.';
      setStatus(`기록 실패: ${message}`);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function registerAccount() {
    setRegisterStatus('계정 생성 중...');
    try {
      const normalized = normalizeUsername(registerForm.username);
      if (!registerForm.password || registerForm.password.length < 8) {
        setRegisterStatus('비밀번호를 8자 이상 입력하세요.');
        return;
      }
      if (registerForm.password !== registerForm.confirm) {
        setRegisterStatus('비밀번호 확인이 일치하지 않습니다.');
        return;
      }
      if (!registerForm.name || !registerForm.department || !registerForm.contact || !registerForm.purpose) {
        setRegisterStatus('ID, 비밀번호, 성함, 부서, 연락처, 사용 목적을 모두 입력하세요.');
        return;
      }
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalized,
          password: registerForm.password,
          name: registerForm.name,
          department: registerForm.department,
          contact: registerForm.contact,
          purpose: registerForm.purpose,
        })
      });

      if (res.ok) {
        setRegisterStatus('계정 생성 완료! 관리자 승인 후 사용 가능합니다.');
        setRegisterForm({ username: '', password: '', confirm: '', name: '', department: '', contact: '', purpose: '' });
      } else {
        const text = await res.text();
        setRegisterStatus(`생성 실패: ${text || res.status}`);
      }
    } catch (err: any) {
      setRegisterStatus(err?.message || '계정 생성 실패');
    }
  }

  async function loadAccounts() {
    setAccountsStatus('목록 불러오는 중...');
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      setAccounts(data || []);
      setAccountsStatus('불러오기 완료');
      markActivity();
    } else {
      const text = await res.text();
      setAccountsStatus(`불러오기 실패: ${text || res.status}`);
    }
  }

  async function updateAccountApproval(id: string, approved: boolean) {
    setAccountsStatus('승인 상태 저장 중...');
    const previous = accounts.map((acc) => ({ ...acc }));
    setAccounts((prev) => prev.map((acc) => (acc.id === id ? { ...acc, approved } : acc)));
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approved })
    });

    if (res.ok) {
      const payload = await res.json().catch(() => null);
      const updated: AccountRow | undefined = payload?.user;
      if (updated) {
        setAccounts((prev) => prev.map((acc) => (acc.id === updated.id ? { ...acc, ...updated } : acc)));
      }
      setAccountsStatus('저장 완료');
    } else {
      const text = await res.text();
      setAccounts(previous);
      setAccountsStatus(`저장 실패: ${text || res.status}`);
      alert(text || '승인 변경 실패');
    }
  }

  async function updateAccountRole(id: string, nextRole: Role) {
    setAccountsStatus('권한 저장 중...');
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role: nextRole })
    });

    if (res.ok) {
      await loadAccounts();
      setAccountsStatus('저장 완료');
    } else {
      const text = await res.text();
      setAccountsStatus(`저장 실패: ${text || res.status}`);
    }
  }

  function openAccountManager() {
    setAccountManagerOpen(true);
    void loadAccounts();
  }

  function closeAccountManager() {
    setAccountManagerOpen(false);
  }

  function handleStockClick(row: InventoryRow) {
    setSelectedStockKeys((prev) => {
      const exists = prev.includes(row.key);
      const next = exists ? prev.filter((id) => id !== row.key) : [...prev, row.key];
      if (exists && focusedStockKey === row.key) {
        setFocusedStockKey(null);
      } else if (!exists) {
        setFocusedStockKey(row.key);
      }
      return next;
    });
  }

  function handleStockDoubleClick(row: InventoryRow) {
    setSelectedStockKeys((prev) => (prev.includes(row.key) ? prev : [...prev, row.key]));
    setFocusedStockKey(row.key);
    const hasMultipleLocations = row.locations.length > 1;
    const defaultLocation = hasMultipleLocations ? '' : row.locations[0]?.location ?? '';

    if (row.locations[0]) {
      setEditDraft({
        id: row.locations[0].id,
        artist: row.artist,
        category: row.category,
        album_version: row.album_version,
        option: row.option,
        location: row.locations[0].location,
        quantity: row.locations[0].quantity,
      });
    }

    setMovement((prev) => ({
      ...prev,
      artist: row.artist,
      category: row.category as MovementPayload['category'],
      album_version: row.album_version,
      option: row.option,
      location: defaultLocation,
      quantity: 0,
    }));

    setStatus(
      hasMultipleLocations
        ? '복수 로케이션 보유: 위치를 직접 선택하세요'
        : '선택한 재고를 입/출고 입력에 불러왔습니다'
    );

    if (row.locations[0]) {
      setFocusedStockKey(row.key);
      setEditDraft({
        id: row.locations[0].id,
        artist: row.artist,
        category: row.category,
        album_version: row.album_version,
        option: row.option,
        location: row.locations[0].location,
        quantity: row.locations[0].quantity,
      });
    }
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

  async function deleteInventoryRow(target?: InventoryRow | InventoryEditDraft) {
    if (sessionRole !== 'admin') {
      alert('재고 삭제는 관리자만 가능합니다.');
      return;
    }
    const row = target && 'locations' in target ? { ...target, ...target.locations[0] } : target ?? editDraft;
    if (!row) return;
    if (!confirm('선택한 재고를 삭제하시겠습니까?')) return;
    setInventoryActionStatus('삭제 중...');
    const res = await fetch(`/api/inventory/${row.id}`, { method: 'DELETE' });
    if (res.ok) {
      setInventoryActionStatus('삭제 완료');
      const removalKey = deriveStockKey('locations' in (target || {}) ? (target as InventoryRow) : row) ?? row.id;
      setSelectedStockKeys((prev) => prev.filter((id) => id !== removalKey));
      if (focusedStockKey === removalKey) {
        setFocusedStockKey(null);
      }
      await refresh();
    } else {
        const text = await res.text();
        setInventoryActionStatus(`삭제 실패: ${text || res.status}`);
        alert(text || '삭제 실패');
      }
    }

  const anomalousStock = useMemo(
    () => stock.filter((row) => row.locations.some((loc) => loc.quantity < 0)),
    [stock]
  );

  const anomalyCount = anomalousStock.length;

  const filteredStock = useMemo(() => {
    const source = showAnomalies ? anomalousStock : stock;
    return source.filter((row) => {
      const locationText = row.locations.map((loc) => `${loc.location} ${loc.quantity}`).join(' ');
      const matchesSearch = [row.artist, row.album_version, row.option, locationText]
        .join(' ')
        .toLowerCase()
        .includes(stockFilters.search.toLowerCase());
      const matchesCategory = !stockFilters.category || row.category === stockFilters.category;
      const matchesLocation =
        !stockFilters.location || row.locations.some((loc) => loc.location === stockFilters.location);
      const matchesArtist = !stockFilters.artist || row.artist === stockFilters.artist;
      return matchesSearch && matchesCategory && matchesLocation && matchesArtist;
    });
  }, [anomalousStock, showAnomalies, stock, stockFilters]);

  const stockLocations = useMemo(
    () => Array.from(new Set(stock.flatMap((row) => row.locations.map((loc) => loc.location)))).filter(Boolean).sort(),
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

  const historyCategoryOptions = useMemo(
    () => Array.from(new Set(history.map((row) => row.category))).filter(Boolean).sort(),
    [history]
  );

  const filteredHistory = useMemo(() => {
    const fromDate = historyFilters.from ? new Date(historyFilters.from) : null;
    const toDate = historyFilters.to ? new Date(`${historyFilters.to}T23:59:59`) : null;
    return history.filter((row) => {
      const matchesDirection = !historyFilters.direction || row.direction === historyFilters.direction;
      const matchesCategory = !historyFilters.category || row.category === historyFilters.category;
      const matchesSearch = [
        row.artist,
        row.album_version,
        row.option,
        row.location,
        row.created_by,
        row.created_by_name ?? '',
        row.created_by_department ?? '',
        row.memo ?? ''
      ]
        .join(' ')
        .toLowerCase()
        .includes(historyFilters.search.toLowerCase());
      const created = new Date(row.created_at);
      const matchesFrom = !fromDate || created >= fromDate;
      const matchesTo = !toDate || created <= toDate;
      return matchesDirection && matchesCategory && matchesSearch && matchesFrom && matchesTo;
    });
  }, [history, historyFilters]);

  const totalQuantity = useMemo(
    () => filteredStock.reduce((sum, row) => sum + row.total_quantity, 0),
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

    if (!idleDeadline || !isLoggedIn) return;

    const remaining = idleDeadline - Date.now();
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
  }, [idleDeadline, isLoggedIn]);

  useEffect(() => {
    if (showAnomalies && anomalyCount === 0) {
      setShowAnomalies(false);
    }
  }, [anomalyCount, showAnomalies]);

  useEffect(() => {
    if (!isLoggedIn) return;
    markActivity();
    const handler = () => markActivity();
    const events: (keyof WindowEventMap)[] = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, handler));
    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handler));
    };
  }, [isLoggedIn]);

  useEffect(() => {
    setShowAdmin(activePanel === 'admin' && sessionRole === 'admin');
  }, [activePanel, sessionRole]);

  useEffect(() => {
    if ((activePanel === 'history' && history.length === 0) || (activePanel === 'stock' && stock.length === 0)) {
      refresh();
    }
  }, [activePanel, history.length, stock.length]);

  useEffect(() => {
    if (!focusedStockKey) {
      setEditDraft(null);
      return;
    }
    const match = stock.find((row) => row.key === focusedStockKey);
    const defaultLocation = match?.locations?.[0];
    if (match && defaultLocation) {
      setEditDraft({
        id: defaultLocation.id,
        artist: match.artist,
        category: match.category,
        album_version: match.album_version,
        option: match.option,
        location: defaultLocation.location,
        quantity: defaultLocation.quantity,
      });
    } else {
      setEditDraft(null);
    }
  }, [focusedStockKey, stock]);

  useEffect(() => {
    if (focusedStockKey && !selectedStockKeys.includes(focusedStockKey)) {
      setFocusedStockKey(null);
    }
  }, [selectedStockKeys, focusedStockKey]);

  useEffect(() => {
    setInventoryActionStatus('');
  }, [selectedStockKeys, focusedStockKey]);

  useEffect(() => {
    fetchSessionInfo();
    refresh();
  }, []);

  return (
    <main className="page">
      <header className="page-header compact-header">
        <div>
          <p className="eyebrow">재고 관리</p>
          <p className="muted">필수 메뉴는 우측 하단 탭과 좌측 입/출고 패널을 이용하세요.</p>
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
          className={editPanelEnabled ? 'tab active' : 'tab disabled'}
          onClick={() => {
            setEditPanelEnabled((prev) => {
              const next = !prev;
              if (!next) {
                setEditDraft(null);
                setFocusedStockKey(null);
              }
              return next;
            });
          }}
        >
          선택 재고 편집
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

      {!isLoggedIn ? (
        <Section title="로그인">
          <div className="form-grid two">
            <div>
              <label>
                <span>사내 ID (@ 없이 입력)</span>
                <input placeholder="예: honggildong" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} />
              </label>
              <label>
                <span>비밀번호</span>
                <input
                  type="password"
                  placeholder="로그인 비밀번호"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </label>
              <div className="actions-row">
                <button onClick={handleAuthToggle}>로그인</button>
                <button className="ghost" onClick={refresh}>세션 확인</button>
              </div>
              <div className="muted">ID + 비밀번호로 로그인합니다.</div>
              <div className="muted">{status}</div>
            </div>
            <div className="card-subpanel">
              <p className="mini-label">새 계정 만들기 (관리자 승인 필요)</p>
              <div className="form-grid two">
                <label>
                  <span>ID</span>
                  <input
                    value={registerForm.username}
                    onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                    placeholder="@ 없이 사내 ID"
                  />
                </label>
                <label>
                  <span>비밀번호</span>
                  <input
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                    placeholder="8자 이상"
                  />
                </label>
                <label>
                  <span>비밀번호 확인</span>
                  <input
                    type="password"
                    value={registerForm.confirm}
                    onChange={(e) => setRegisterForm({ ...registerForm, confirm: e.target.value })}
                    placeholder="비밀번호 재입력"
                  />
                </label>
                <label>
                  <span>성함</span>
                  <input
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                    placeholder="홍길동"
                  />
                </label>
                <label>
                  <span>부서</span>
                  <input
                    value={registerForm.department}
                    onChange={(e) => setRegisterForm({ ...registerForm, department: e.target.value })}
                    placeholder="물류팀"
                  />
                </label>
                <label>
                  <span>연락처</span>
                  <input
                    value={registerForm.contact}
                    onChange={(e) => setRegisterForm({ ...registerForm, contact: e.target.value })}
                    placeholder="010-0000-0000"
                  />
                </label>
                <label className="wide">
                  <span>사용 목적</span>
                  <input
                    value={registerForm.purpose}
                    onChange={(e) => setRegisterForm({ ...registerForm, purpose: e.target.value })}
                    placeholder="예: 매장 재고 확인"
                  />
                </label>
              </div>
              <div className="actions-row">
                <button onClick={registerAccount}>계정 생성</button>
                <span className="muted">{registerStatus || '모든 정보를 입력하면 계정이 생성되며, 관리자 승인 후 사용 가능합니다.'}</span>
              </div>
            </div>
          </div>
        </Section>
      ) : (
        <Section title="로그인 완료">
          <div className="actions-row">
            <div>
              <p className="mini-label">현재 세션</p>
              <div className="muted">{sessionEmail} ({sessionRole})</div>
            </div>
            <div className="actions-row">
              <button onClick={handleAuthToggle}>로그아웃</button>
              <button className="ghost" onClick={refresh}>데이터 새로고침</button>
            </div>
          </div>
        </Section>
      )}

      {pendingBlock && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="mini-label">승인 대기</p>
            <p className="muted">{pendingBlock}</p>
            <div className="actions-row">
              <button onClick={() => setPendingBlock(null)}>확인</button>
            </div>
          </div>
        </div>
      )}

      {activePanel === 'admin' && showAdmin && (
        <div ref={adminRef} className="panel-anchor">
        <Section
          title="관리자 도구"
          actions={
            <div className="section-actions">
              <button className="ghost" onClick={openAccountManager}>계정 관리</button>
              <Pill>admin 전용</Pill>
            </div>
          }
        >
          <div className="guide-grid">
            <div className="guide-card">
              <p className="mini-label">관리자 안내</p>
              <ol className="muted">
                <li>관리자 계정으로 로그인 후 세션을 확인하세요.</li>
                <li>입/출고 기록 후 재고와 이력 화면에서 결과를 검증하세요.</li>
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
          </div>
        </Section>
        </div>
      )}

      {activePanel === 'stock' && (
        <div className="split-panels" ref={stockRef}>
          <div className="left-sticky">
            <Section
              title="입/출고 등록"
              actions={
                <div className="section-actions">
                  <button className="ghost" onClick={() => setMovement(EMPTY_MOVEMENT)}>입력값 초기화</button>
                </div>
              }
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const direction: 'IN' | 'OUT' = movement.direction === 'OUT' ? 'OUT' : 'IN';
                  submitMovement(direction);
                }}
              >
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
                      min={1}
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
                    onClick={() => submitMovement('IN')}
                  >
                    {isSubmitting ? '처리 중...' : '입고'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    className="secondary"
                    onClick={() => submitMovement('OUT')}
                  >
                    {isSubmitting ? '처리 중...' : '출고'}
                  </button>
                  <p className="muted">입고/출고를 버튼으로 나눠 Python GUI와 동일한 동선을 제공합니다.</p>
                </div>
              </form>
            </Section>
          </div>
          <div className="right-panel">
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
                  <a className="ghost button-link" href="/api/export?type=inventory">엑셀 다운로드</a>
                </div>
              }
            >
              {anomalyCount > 0 && (
                <div className="alert-row">
                  <button
                    type="button"
                    className={showAnomalies ? 'warning-button active' : 'warning-button'}
                    onClick={() => setShowAnomalies((prev) => !prev)}
                  >
                    이상재고 {anomalyCount}건
                  </button>
                  <span className="muted small-text">음수 수량만 따로 모아 볼 수 있습니다.</span>
                </div>
              )}
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
                      <React.Fragment key={row.key}>
                        <tr
                          className={selectedStockKeys.includes(row.key) ? 'selected-row' : ''}
                          onClick={() => handleStockClick(row)}
                          onDoubleClick={() => handleStockDoubleClick(row)}
                        >
                          <td>{row.artist}</td>
                          <td>{row.category}</td>
                          <td>{row.album_version}</td>
                          <td>{row.option}</td>
                          <td>
                            <div className="pill-row wrap">
                              {row.locations.map((loc) => (
                                <button
                                  key={`${row.key}-${loc.id}`}
                                  className="ghost small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedStockKeys((prev) =>
                                      prev.includes(row.key) ? prev : [...prev, row.key]
                                    );
                                    setFocusedStockKey(row.key);
                                    setEditDraft({
                                      id: loc.id,
                                      artist: row.artist,
                                      category: row.category,
                                      album_version: row.album_version,
                                      option: row.option,
                                      location: loc.location,
                                      quantity: loc.quantity,
                                    });
                                  }}
                                >
                                  {loc.location}: {loc.quantity.toLocaleString()}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="align-right">{row.total_quantity.toLocaleString()}</td>
                          <td>
                            {sessionRole === 'viewer' ? (
                              <span className="muted">읽기 전용</span>
                            ) : (
                              <div className="row-actions">
                                <button
                                  className="ghost small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedStockKeys((prev) =>
                                      prev.includes(row.key) ? prev : [...prev, row.key]
                                    );
                                    const loc = row.locations[0];
                                    if (loc) {
                                      setFocusedStockKey(row.key);
                                      setEditDraft({
                                        id: loc.id,
                                        artist: row.artist,
                                        category: row.category,
                                        album_version: row.album_version,
                                        option: row.option,
                                        location: loc.location,
                                        quantity: loc.quantity,
                                      });
                                    }
                                  }}
                                >
                                  선택
                                </button>
                                {sessionRole === 'admin' && (
                                  <button
                                    className="ghost danger small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedStockKeys((prev) =>
                                        prev.includes(row.key) ? prev : [...prev, row.key]
                                      );
                                      setFocusedStockKey(row.key);
                                      deleteInventoryRow(row);
                                    }}
                                  >
                                    삭제
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                        {editPanelEnabled && sessionRole !== 'viewer' && editDraft && focusedStockKey === row.key && (
                          <tr className="inline-editor-row">
                            <td colSpan={7}>
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
                                  {sessionRole === 'admin' && (
                                    <button className="ghost danger" onClick={() => deleteInventoryRow(editDraft)}>
                                      삭제
                                    </button>
                                  )}
                                  <span className="muted">{inventoryActionStatus || '선택 행만 operator 수정 · 관리자 삭제 가능'}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        </div>
      )}

      {activePanel === 'history' && (
      <div ref={historyRef} className="panel-anchor">
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
            <select
              className="compact"
              value={historyFilters.category}
              onChange={(e) => setHistoryFilters({ ...historyFilters, category: e.target.value })}
            >
              <option value="">전체 카테고리</option>
              {historyCategoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
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
            <button className="ghost" type="button" onClick={reloadHistory}>
              새로고침
            </button>
            <a className="ghost button-link" href="/api/export?type=history">엑셀 다운로드</a>
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
                <th className="align-center">담당</th>
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
                <td className="align-center">
                  <div className="stacked-label">
                    <strong>{h.created_by_name || h.created_by || '-'}</strong>
                    <span className="muted small-text">{h.created_by_department || '부서 정보 없음'}</span>
                  </div>
                </td>
                <td>{h.memo || '-'}</td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      </Section>
      </div>
      )}

      <div className="floating-nav">
        <button className={activePanel === 'stock' ? 'tab active' : 'tab'} onClick={() => scrollToPanel('stock')}>
          현재 재고
        </button>
        <button className={activePanel === 'history' ? 'tab active' : 'tab'} onClick={() => scrollToPanel('history')}>
          입출고 이력
        </button>
        <button
          className={editPanelEnabled ? 'tab active' : 'tab disabled'}
          onClick={() => {
            setEditPanelEnabled((prev) => {
              const next = !prev;
              if (!next) {
                setEditDraft(null);
                setFocusedStockKey(null);
              }
              return next;
            });
          }}
        >
          선택 재고 편집
        </button>
        <button
          className={activePanel === 'admin' ? 'tab active' : 'tab'}
          onClick={() => scrollToPanel('admin')}
          disabled={sessionRole !== 'admin'}
          title={sessionRole === 'admin' ? undefined : '관리자 로그인 필요'}
        >
          관리자 페이지
        </button>
      </div>

      {accountManagerOpen && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-heading">
              <h3>계정 관리</h3>
              <div className="section-actions">
                <button className="ghost" onClick={loadAccounts}>새로고침</button>
                <button className="ghost" onClick={closeAccountManager}>닫기</button>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              ID, 실명, 부서를 확인하고 권한과 승인 여부를 바로 수정할 수 있습니다.
            </p>
            <div className="table-wrapper">
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>이메일</th>
                    <th>성함</th>
                    <th>부서</th>
                    <th>연락처</th>
                    <th>사용 목적</th>
                    <th>권한</th>
                    <th>승인</th>
                    <th>생성일</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={9}>계정 정보가 없습니다.</td>
                    </tr>
                  )}
                  {accounts.map((acc) => (
                    <tr key={acc.id}>
                      <td>{acc.username}</td>
                      <td>{acc.email}</td>
                      <td>{acc.full_name}</td>
                      <td>{acc.department || '-'}</td>
                      <td>{acc.contact || '-'}</td>
                      <td>{acc.purpose || '-'}</td>
                      <td>
                        <select
                          value={acc.role}
                          onChange={(e) => updateAccountRole(acc.id, e.target.value as Role)}
                        >
                          <option value="admin">admin</option>
                          <option value="operator">operator</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </td>
                      <td>
                        <label className="muted small-text" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={acc.approved}
                            onChange={(e) => updateAccountApproval(acc.id, e.target.checked)}
                          />
                          승인 여부
                        </label>
                      </td>
                      <td>{formatDate(acc.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted">{accountsStatus}</div>
          </div>
        </div>
      )}
    </main>
  );
}
