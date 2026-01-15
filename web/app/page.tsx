'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { getSupabaseClient } from '../lib/supabaseClient';
import BulkTransferPanel from '../components/BulkTransferPanel';

type InventoryLocation = {
  id: string;
  location: string;
  quantity: number;
  editableId?: string | null;
  item_id?: string | null;
  inventory_id?: string | null;
};

type InventoryRow = {
  key: string;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  total_quantity: number;
  locations: InventoryLocation[];
  inventory_id?: string | null;
  item_id?: string | null;
  barcode?: string | null;
};

type InventoryApiRow = {
  inventory_id?: string;
  item_id?: string;
  barcode?: string | null;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
};

type InventorySummary = {
  totalQuantity: number;
  uniqueItems: number;
  byLocation: Record<string, number>;
};

type InventoryMeta = {
  summary: InventorySummary;
  anomalyCount: number;
  artists: string[];
  locations: string[];
  categories: string[];
};

type InventoryEditDraft = InventoryLocation & Omit<InventoryRow, 'locations' | 'total_quantity' | 'key'>;

type HistoryRow = {
  created_at: string;
  direction: 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER';
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
  primary_location?: string | null;
  sub_locations?: string[];
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
  barcode?: string;
  item_id?: string | null;
};

type TransferPayload = {
  artist: string;
  category: 'album' | 'md';
  album_version: string;
  option: string;
  from_location: string;
  to_location: string;
  quantity: number;
  memo: string;
  barcode?: string;
  item_id?: string | null;
};

type Role = 'admin' | 'operator' | 'viewer' | 'l_operator' | 'manager';

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
  memo: '',
  barcode: ''
};

const EMPTY_TRANSFER: TransferPayload = {
  artist: '',
  category: 'album',
  album_version: '',
  option: '',
  from_location: '',
  to_location: '',
  quantity: 0,
  memo: '',
  barcode: '',
};

type HistoryPage = {
  page: number;
  pageSize: number;
  totalRows: number;
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

const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

function formatDate(value: string) {
  return kstFormatter.format(new Date(value));
}

function kstDate(offsetDays = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  now.setDate(now.getDate() + offsetDays);
  return now;
}

function toKstDateInput(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const parseKstDate = (value: string) => Date.parse(`${value}T00:00:00+09:00`);

function findMatchingStock(
  rows: InventoryRow[],
  artist: string,
  category: string,
  albumVersion: string,
  option: string
): InventoryRow | undefined {
  return rows.find(
    (row) =>
      row.artist === artist &&
      row.category === category &&
      row.album_version === albumVersion &&
      row.option === option
  );
}

function buildBarcodeBars(value: string) {
  const chars = value.split('');
  let x = 0;
  const bars: Array<{ x: number; width: number; height: number }> = [];
  chars.forEach((char, index) => {
    const code = char.charCodeAt(0);
    const width = 1 + (code % 3);
    const height = 64 + (code % 4) * 6;
    bars.push({ x, width, height });
    x += width + (index % 2 === 0 ? 1 : 2);
  });
  return { bars, width: x };
}

function BarcodePreview({ value }: { value: string }) {
  const safeValue = value.trim();
  if (!safeValue) return null;
  const { bars, width } = buildBarcodeBars(safeValue);
  const height = Math.max(...bars.map((bar) => bar.height), 80);
  const displayWidth = Math.max(width * 4, 280);
  return (
    <svg
      className="barcode-preview"
      viewBox={`0 0 ${Math.max(width, 1)} ${height}`}
      style={{ width: `${displayWidth}px`, height: '80px' }}
      aria-label={`barcode-${safeValue}`}
      role="img"
    >
      {bars.map((bar, index) => (
        <rect key={`${safeValue}-${index}`} x={bar.x} y={0} width={bar.width} height={bar.height} fill="#111" />
      ))}
    </svg>
  );
}

function normalizeStockToApiRows(rows: InventoryRow[]): InventoryApiRow[] {
  return rows.flatMap((row, idx) =>
    row.locations.map((loc, locIdx) => ({
      inventory_id: loc.editableId ?? loc.inventory_id ?? loc.id ?? `${row.key}|${loc.location}|${idx}|${locIdx}`,
      item_id: loc.item_id ?? row.item_id ?? undefined,
      barcode: row.barcode ?? undefined,
      artist: row.artist,
      category: row.category,
      album_version: row.album_version,
      option: row.option,
      location: loc.location,
      quantity: Number(loc.quantity ?? 0),
    }))
  );
}

function groupInventoryRows(rows: InventoryApiRow[]): InventoryRow[] {
  const grouped = new Map<string, InventoryRow>();

  rows.forEach((row, idx) => {
    const artist = row.artist ?? '';
    const category = row.category ?? '';
    const album_version = row.album_version ?? '';
    const option = row.option ?? '';
    const key = `${artist}|${category}|${album_version}|${option}`;
    const qty = Number(row.quantity ?? 0);

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        artist,
        category,
        album_version,
        option,
        total_quantity: 0,
        locations: [],
        inventory_id: row.inventory_id ?? null,
        item_id: row.item_id ?? null,
        barcode: row.barcode ?? null,
      });
    }

    const entry = grouped.get(key)!;
    entry.total_quantity += qty;
    if (!entry.item_id && row.item_id) {
      entry.item_id = row.item_id;
    }
    if (!entry.inventory_id && row.inventory_id) {
      entry.inventory_id = row.inventory_id;
    }
    if (!entry.barcode && row.barcode) {
      entry.barcode = row.barcode;
    }
    entry.locations.push({
      id: row.inventory_id || `${key}|${row.location}|${idx}`,
      editableId: row.inventory_id ?? null,
      inventory_id: row.inventory_id ?? null,
      item_id: row.item_id ?? null,
      location: row.location,
      quantity: qty,
    });
  });

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    locations: row.locations.sort((a, b) => a.location.localeCompare(b.location)),
  }));
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
  const [transferPayload, setTransferPayload] = useState<TransferPayload>(EMPTY_TRANSFER);
  const [activeTab, setActiveTab] = useState<'movement' | 'transfer' | 'bulk_transfer'>('movement');
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<string[]>([]);
  const [mobileFormOpen, setMobileFormOpen] = useState(false);
  const [selectedStockKeys, setSelectedStockKeys] = useState<string[]>([]);
  const [focusedStockKey, setFocusedStockKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InventoryEditDraft | null>(null);
  const [activePanel, setActivePanel] = useState<'stock' | 'history' | 'admin'>('stock');
  const [stockFilters, setStockFilters] = useState({
    q: '',
    albumVersion: '',
    barcode: '',
    artist: '',
    location: '',
    category: '',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [albumVersionTerm, setAlbumVersionTerm] = useState('');
  const [barcodeTerm, setBarcodeTerm] = useState('');
  const [inventoryMeta, setInventoryMeta] = useState<InventoryMeta>({
    summary: { totalQuantity: 0, uniqueItems: 0, byLocation: {} },
    anomalyCount: 0,
    artists: [],
    locations: [],
    categories: [],
  });
  const [inventoryPage, setInventoryPage] = useState({ limit: 50, offset: 0, totalRows: 0 });
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
  const defaultHistoryTo = useMemo(() => toKstDateInput(kstDate(0)), []);
  const defaultHistoryFrom = useMemo(() => toKstDateInput(kstDate(-15)), []);
  const [historyFilters, setHistoryFilters] = useState({
    search: '',
    direction: '',
    category: '',
    from: defaultHistoryFrom,
    to: defaultHistoryTo
  });
  const [historyPage, setHistoryPage] = useState<HistoryPage>({ page: 1, pageSize: 50, totalRows: 0 });
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsStatus, setAccountsStatus] = useState('');
  const [locationScopes, setLocationScopes] = useState<Record<string, { primary: string; subs: string }>>({});
  const [locationScopeAvailable, setLocationScopeAvailable] = useState(true);
  const [registerStatus, setRegisterStatus] = useState('');
  const [adminStatus, setAdminStatus] = useState('');
  const [sessionRole, setSessionRole] = useState<Role | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionScope, setSessionScope] = useState<{ primary_location?: string | null; sub_locations?: string[] } | null>(
    null
  );
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
  const barcodeBufferRef = useRef('');
  const barcodeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const movementBarcodeSource = useMemo(() => {
    const artistValue = movement.artist.trim();
    const albumValue = movement.album_version.trim();
    if (!artistValue || !albumValue) return null;
    return findMatchingStock(stock, artistValue, movement.category, albumValue, movement.option);
  }, [stock, movement.artist, movement.album_version, movement.category, movement.option]);

  const movementBarcodeLocked = sessionRole !== 'admin' && Boolean(movementBarcodeSource?.barcode);

  const transferBarcodeSource = useMemo(() => {
    const artistValue = transferPayload.artist.trim();
    const albumValue = transferPayload.album_version.trim();
    if (!artistValue || !albumValue) return null;
    return findMatchingStock(stock, artistValue, transferPayload.category, albumValue, transferPayload.option);
  }, [stock, transferPayload.artist, transferPayload.album_version, transferPayload.category, transferPayload.option]);

  const transferBarcodeLocked = sessionRole !== 'admin' && Boolean(transferBarcodeSource?.barcode);

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
      setSessionScope(null);
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
    setSessionScope(data.locationScope ?? null);
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

  async function fetchInventoryMeta(filters: typeof stockFilters, options?: { prefix?: string }) {
    const params = new URLSearchParams();
    if (filters.artist) params.set('artist', filters.artist);
    if (filters.location) params.set('location', filters.location);
    if (filters.category) params.set('category', filters.category);
    if (filters.q) params.set('q', filters.q);
    if (filters.albumVersion) params.set('album_version', filters.albumVersion);
    if (filters.barcode) params.set('barcode', filters.barcode);
    if (options?.prefix !== undefined) params.set('prefix', options.prefix ?? '');

    const metaRes = await fetch(`/api/inventory/meta?${params.toString()}`, { cache: 'no-store' });
    if (metaRes.ok) {
      const payload = await metaRes.json();
      if (payload?.ok) {
        setInventoryMeta({
          summary: payload.summary ?? { totalQuantity: 0, uniqueItems: 0, byLocation: {} },
          anomalyCount: Number(payload.anomalyCount ?? 0),
          artists: payload.artists ?? [],
          locations: payload.locations ?? [],
          categories: payload.categories ?? [],
        });
        return;
      }
    }
    setStatus('재고 메타데이터 불러오기 실패');
  }

  function buildInventoryParams(filters: typeof stockFilters, limit?: number, offset?: number) {
    const params = new URLSearchParams();
    if (filters.artist) params.set('artist', filters.artist);
    if (filters.location) params.set('location', filters.location);
    if (filters.category) params.set('category', filters.category);
    if (filters.q) params.set('q', filters.q);
    if (filters.albumVersion) params.set('album_version', filters.albumVersion);
    if (filters.barcode) params.set('barcode', filters.barcode);
    if (typeof limit === 'number') params.set('limit', String(limit));
    if (typeof offset === 'number') params.set('offset', String(Math.max(0, offset)));
    return params;
  }

  async function reloadInventory(options?: {
    offset?: number;
    limit?: number;
    filters?: typeof stockFilters;
    fetchMeta?: boolean;
    prefix?: string;
    suppressErrors?: boolean;
  }) {
    const nextFilters = options?.filters ?? stockFilters;
    const nextOffset = options?.offset ?? inventoryPage.offset;
    const nextLimit = options?.limit ?? inventoryPage.limit;

    const params = buildInventoryParams(nextFilters, nextLimit, nextOffset);

    const stockRes = await fetch(`/api/inventory?${params.toString()}`, { cache: 'no-store' });
    if (stockRes.ok) {
      const payload = await stockRes.json();
      if (payload?.ok) {
        if (options?.filters) {
          setStockFilters(options.filters);
        }
        setInventoryPage({
          limit: payload.page?.limit ?? nextLimit,
          offset: payload.page?.offset ?? nextOffset,
          totalRows: payload.page?.totalRows ?? 0,
        });
        setStock(groupInventoryRows(payload.rows || []));

        if (options?.fetchMeta !== false) {
          await fetchInventoryMeta(nextFilters, { prefix: options?.prefix ?? nextFilters.q });
        }
        return;
      }
    }
    if (!options?.suppressErrors) {
      setStatus('재고 불러오기 실패');
    }
  }

  function applyInventoryFilters(next: typeof stockFilters) {
    const nextOffset = 0;
    setInventoryPage((prev) => ({ ...prev, offset: nextOffset }));
    setStockFilters(next);
    reloadInventory({ filters: next, offset: nextOffset, prefix: next.q, fetchMeta: true });
  }

  function handleInventorySearchSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const next = {
      ...stockFilters,
      q: searchTerm.trim(),
      albumVersion: albumVersionTerm.trim(),
      barcode: barcodeTerm.trim(),
    };
    applyInventoryFilters(next);
  }

  function applyBarcodeScan(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBarcodeTerm(trimmed);
    setSearchTerm('');
    setAlbumVersionTerm('');
    const next = { ...stockFilters, q: '', albumVersion: '', barcode: trimmed };
    applyInventoryFilters(next);
  }

  function resetInventorySearch() {
    setSearchTerm('');
    setAlbumVersionTerm('');
    setBarcodeTerm('');
    const cleared = { ...stockFilters, q: '', albumVersion: '', barcode: '', artist: '', location: '', category: '' };
    applyInventoryFilters(cleared);
  }

  function changeInventoryPage(nextOffset: number) {
    const clamped = Math.max(0, nextOffset);
    setInventoryPage((prev) => ({ ...prev, offset: clamped }));
    reloadInventory({ offset: clamped, fetchMeta: true });
  }

  async function reloadHistory(options?: { page?: number; pageSize?: number; suppressErrors?: boolean }) {
    const params = new URLSearchParams();
    if (historyFilters.from) params.set('startDate', historyFilters.from);
    if (historyFilters.to) params.set('endDate', historyFilters.to);
    const nextPage = options?.page ?? historyPage.page;
    const nextPageSize = options?.pageSize ?? historyPage.pageSize;
    params.set('page', String(Math.max(1, nextPage)));
    params.set('pageSize', String(nextPageSize));

    const qs = params.toString();
    const histRes = await fetch(qs ? `/api/history?${qs}` : '/api/history', { cache: 'no-store' });
    if (histRes.ok) {
      const payload = await histRes.json();
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.rows)
        ? payload.rows
        : [];
      const rows = list.map((row: any) => ({
        ...row,
        option: row.option ?? '',
        created_by_name: row.created_by_name ?? '',
        created_by_department: row.created_by_department ?? '',
      }));
      setHistory(rows);
      setHistoryPage({
        page: payload?.page?.page ?? nextPage,
        pageSize: payload?.page?.pageSize ?? nextPageSize,
        totalRows: payload?.page?.totalRows ?? rows.length,
      });
    } else if (!options?.suppressErrors) {
      const payload = await histRes.json().catch(() => null);
      const message = payload?.error || payload?.message || '입출고 이력 불러오기 실패';
      setStatus(message);
      alert(message);
    }
  }

  function changeHistoryPage(nextPage: number) {
    const clamped = Math.max(1, nextPage);
    setHistoryPage((prev) => ({ ...prev, page: clamped }));
    reloadHistory({ page: clamped });
  }

  function changeHistoryPageSize(nextSize: number) {
    const size = Math.max(1, Math.min(nextSize, 200));
    setHistoryPage((prev) => ({ ...prev, page: 1, pageSize: size }));
    reloadHistory({ page: 1, pageSize: size });
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

  async function submitMovement(direction: MovementPayload['direction']) {
    const artistValue = movement.artist.trim();
    const albumVersion = movement.album_version.trim();
    const locationValue = movement.location.trim();
    const quantityValue = Number(movement.quantity);
    const memoValue = movement.memo.trim();
    const optionValue = movement.option;
    const categoryValue = movement.category;
    const barcodeValue = movement.barcode?.trim() || '';

    if (!artistValue || !albumVersion || !locationValue || !quantityValue) {
      alert('아티스트, 앨범/버전, 로케이션 정보를 모두 입력해야 합니다.');
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

    const matchingStock = findMatchingStock(stock, artistValue, categoryValue, albumVersion, optionValue);
    const effectiveBarcode = barcodeValue || matchingStock?.barcode || '';

    if (categoryValue === 'md' && !effectiveBarcode && !matchingStock) {
      alert('MD 카테고리 신규 등록에는 바코드가 필요합니다.');
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
          barcode: effectiveBarcode || undefined,
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

      await Promise.all([
        reloadInventory({ suppressErrors: true }),
        reloadHistory({ suppressErrors: true }),
      ]);
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

  async function submitTransfer() {
    const artistValue = transferPayload.artist.trim();
    const albumVersion = transferPayload.album_version.trim();
    const fromLocation =
      (sessionRole === 'l_operator' || sessionRole === 'manager') && sessionScope?.primary_location
        ? sessionScope.primary_location.trim()
        : transferPayload.from_location.trim();
    const toLocation = transferPayload.to_location.trim();
    const quantityValue = Number(transferPayload.quantity);
    const memoValue = transferPayload.memo.trim();
    if (!artistValue || !albumVersion || !fromLocation || !toLocation || !quantityValue) {
      alert('전산이관은 품목, 보낸/받는 로케이션, 수량을 모두 입력해야 합니다.');
      return;
    }
    if (!memoValue) {
      alert('전산이관 메모는 필수입니다.');
      return;
    }

    if (sessionRole === 'l_operator' || sessionRole === 'manager') {
      const primary = sessionScope?.primary_location?.trim();
      const subs = (sessionScope?.sub_locations ?? []).map((v) => v.trim()).filter(Boolean);
      if (!primary) {
        alert('담당 로케이션이 지정되지 않아 전산이관을 진행할 수 없습니다.');
        return;
      }
      if (fromLocation !== primary) {
        alert('담당 로케이션에서만 전산이관을 시작할 수 있습니다.');
        return;
      }
      if (subs.length === 0 || !subs.includes(toLocation)) {
        alert('받는 곳은 서브 로케이션 중에서만 선택할 수 있습니다.');
        return;
      }
    }

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      alert('수량은 1 이상의 양수만 입력 가능합니다.');
      return;
    }

    setIsSubmitting(true);
    setStatus('전산이관 처리 중...');
    markActivity();

    try {
      const idempotencyKey = `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: artistValue,
          category: transferPayload.category,
          album_version: albumVersion,
          option: transferPayload.option ?? '',
          fromLocation,
          toLocation,
          quantity: Number(quantityValue),
          memo: memoValue,
          barcode: transferPayload.barcode ?? '',
          idempotencyKey,
        })
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.ok !== true) {
        const message = payload?.error || payload?.message || `전산이관 실패 (${res.status})`;
        const stepMessage = payload?.step ? `${message} [${payload.step}]` : message;
        console.error('transfer submit error:', { message: stepMessage, payload });
        alert(stepMessage);
        setStatus(stepMessage);
        return;
      }
      await Promise.all([reloadInventory(), reloadHistory()]);
      setStatus('전산이관 완료');
      const baseTransfer = {
        ...EMPTY_TRANSFER,
        from_location:
          (sessionRole === 'l_operator' || sessionRole === 'manager') && sessionScope?.primary_location
            ? sessionScope.primary_location
            : '',
      };
      setTransferPayload(baseTransfer);
    } catch (err: any) {
      const message = err?.message || '전산이관 처리 중 오류가 발생했습니다.';
      setStatus(`전산이관 실패: ${message}`);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetTransferForm() {
    setTransferPayload({
      ...EMPTY_TRANSFER,
      from_location:
        (sessionRole === 'l_operator' || sessionRole === 'manager') && sessionScope?.primary_location
          ? sessionScope.primary_location
          : '',
    });
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
    setLocationScopeAvailable(res.headers.get('x-location-scope') !== 'disabled');
    if (res.ok) {
      const data = await res.json();
      setAccounts(data || []);
      const scopeMap: Record<string, { primary: string; subs: string }> = {};
      (data || []).forEach((row: AccountRow) => {
        scopeMap[row.id] = {
          primary: row.primary_location || '',
          subs: (row.sub_locations || []).join(', '),
        };
      });
      setLocationScopes(scopeMap);
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

  async function saveAccountScope(id: string) {
    if (!locationScopeAvailable) {
      setAccountsStatus('로케이션 범위 저장은 현재 비활성화되어 있습니다.');
      return;
    }
    const scope = locationScopes[id] || { primary: '', subs: '' };
    const payload = {
      id,
      primary_location: scope.primary.trim(),
      sub_locations: scope.subs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    setAccountsStatus('로케이션 범위 저장 중...');
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setAccountsStatus('저장 완료');
      await loadAccounts();
    } else {
      const text = await res.text();
      setAccountsStatus(`저장 실패: ${text || res.status}`);
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

  function applyStockRowToForms(row: InventoryRow) {
    setSelectedStockKeys((prev) => (prev.includes(row.key) ? prev : [...prev, row.key]));
    setFocusedStockKey(row.key);
    const hasMultipleLocations = row.locations.length > 1;
    const defaultLocation = hasMultipleLocations ? '' : row.locations[0]?.location ?? '';

    setMovement((prev) => ({
      ...prev,
      artist: row.artist,
      category: row.category as MovementPayload['category'],
      album_version: row.album_version,
      option: row.option,
      barcode: row.barcode ?? '',
      location: defaultLocation,
      quantity: 0,
    }));

    setTransferPayload((prev) => ({
      ...prev,
      artist: row.artist,
      category: row.category as TransferPayload['category'],
      album_version: row.album_version,
      option: row.option,
      barcode: row.barcode ?? '',
      from_location:
        (sessionRole === 'l_operator' || sessionRole === 'manager') && sessionScope?.primary_location
          ? sessionScope.primary_location
          : row.locations[0]?.location ?? prev.from_location,
      to_location: prev.to_location,
      quantity: Number.isFinite(prev.quantity) ? prev.quantity : 0,
      item_id: row.item_id ?? prev.item_id ?? null,
    }));

    setStatus(
      hasMultipleLocations
        ? '복수 로케이션 보유: 위치를 직접 선택하세요'
        : '선택한 재고를 입/출고 입력에 불러왔습니다'
    );

    if (row.locations[0]) {
      setFocusedStockKey(row.key);
      setEditDraft({
        id: row.locations[0].editableId ?? row.locations[0].id,
        artist: row.artist,
        category: row.category,
        album_version: row.album_version,
        option: row.option,
        barcode: row.barcode ?? '',
        location: row.locations[0].location,
        quantity: row.locations[0].quantity,
      });
    }
  }

  function handleStockDoubleClick(row: InventoryRow) {
    applyStockRowToForms(row);
  }

  function toggleBulkSelection(key: string) {
    setBulkSelectedKeys((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  }

  function selectAllBulk(rows: InventoryRow[]) {
    setBulkSelectedKeys(rows.map((row) => row.key));
  }

  function clearBulkSelection() {
    setBulkSelectedKeys([]);
  }

  async function saveInventoryEdit() {
    if (!editDraft) return;
    if (!editDraft.id) {
      alert('이 재고 항목은 편집할 수 없습니다.');
      return;
    }
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
    if (!row.id) {
      alert('이 재고 항목은 삭제할 수 없습니다.');
      setInventoryActionStatus('');
      return;
    }
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

  const albumVersionFilter = stockFilters.albumVersion.trim().toLowerCase();

  const baseStock = useMemo(() => {
    if (!albumVersionFilter) return stock;
    return stock.filter((row) => row.album_version.toLowerCase().includes(albumVersionFilter));
  }, [albumVersionFilter, stock]);

  const anomalousStock = useMemo(() => {
    return baseStock.filter((row) => row.locations.some((loc) => Number(loc.quantity) < 0));
  }, [baseStock]);

  const anomalyCount = Math.max(anomalousStock.length, Number(inventoryMeta.anomalyCount ?? 0));

  const filteredStock = useMemo(() => {
    if (showAnomalies) {
      return anomalousStock;
    }
    return baseStock;
  }, [anomalousStock, baseStock, showAnomalies]);

  const bulkSelectedRows = useMemo(() => {
    if (bulkSelectedKeys.length === 0) return [];
    const lookup = new Map(stock.map((row) => [row.key, row]));
    return bulkSelectedKeys.map((key) => lookup.get(key)).filter(Boolean) as InventoryRow[];
  }, [bulkSelectedKeys, stock]);

  const locationOptions = useMemo(
    () => Array.from(new Set([...locationPresets, ...inventoryMeta.locations])).filter(Boolean).sort(),
    [inventoryMeta.locations, locationPresets]
  );

  const filterLocationOptions = useMemo(
    () => Array.from(new Set(inventoryMeta.locations)).filter(Boolean).sort(),
    [inventoryMeta.locations]
  );

  const artistOptions = useMemo(
    () => Array.from(new Set(inventoryMeta.artists)).filter(Boolean).sort(),
    [inventoryMeta.artists]
  );

  const categoryOptions = useMemo(
    () => Array.from(new Set(inventoryMeta.categories)).filter(Boolean).sort(),
    [inventoryMeta.categories]
  );

  const historyCategoryOptions = useMemo(
    () => Array.from(new Set(history.map((row) => row.category))).filter(Boolean).sort(),
    [history]
  );

  const filteredHistory = useMemo(() => {
    const fromDateMs = historyFilters.from ? parseKstDate(historyFilters.from) : null;
    const toDateMs = historyFilters.to ? parseKstDate(historyFilters.to) + 24 * 60 * 60 * 1000 : null;
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
      const createdKstMs = Date.parse(row.created_at) + 9 * 60 * 60 * 1000;
      const matchesFrom = !fromDateMs || createdKstMs >= fromDateMs;
      const matchesTo = !toDateMs || createdKstMs < toDateMs;
      return matchesDirection && matchesCategory && matchesSearch && matchesFrom && matchesTo;
    });
  }, [history, historyFilters]);

  const historyTotalPages = Math.max(1, Math.ceil((historyPage.totalRows || 0) / historyPage.pageSize));
  const historyCurrentPage = Math.min(historyTotalPages, historyPage.page);
  const historyCanPrev = historyCurrentPage > 1;
  const historyCanNext = historyCurrentPage < historyTotalPages;

  function exportToExcel(rows: any[], filename: string, sheetName: string) {
    const workbook = utils.book_new();
    const sheet = utils.json_to_sheet(rows.length ? rows : [{}]);
    utils.book_append_sheet(workbook, sheet, sheetName);
    writeFile(workbook, filename);
  }

  async function fetchAllInventoryForExport() {
    const pageLimit = 200;
    let offset = 0;
    let total = Number.MAX_SAFE_INTEGER;
    const rows: InventoryApiRow[] = [];
    while (offset < total) {
      const params = buildInventoryParams(stockFilters, pageLimit, offset);
      const res = await fetch(`/api/inventory?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) break;
      const payload = await res.json();
      if (!payload?.ok) break;
      rows.push(...(payload.rows || []));
      total = payload.page?.totalRows ?? rows.length;
      offset += pageLimit;
      if (!payload.rows || payload.rows.length < pageLimit) break;
    }
    return rows;
  }

  async function exportInventory() {
    setInventoryActionStatus('엑셀 내보내는 중...');
    const allRows = await fetchAllInventoryForExport();
    const sourceRows: InventoryApiRow[] = allRows.length ? allRows : normalizeStockToApiRows(stock);
    const grouped = groupInventoryRows(sourceRows);
    const rows = grouped.map((row) => {
      console.info('export_map_row', { step: 'export_map_row', key: row.key, barcode: row.barcode ?? '' });
      return {
        artist: row.artist,
        category: row.category,
        album_version: row.album_version,
        option: row.option,
        바코드: row.barcode ?? '',
        locations: row.locations.map((loc) => `${loc.location}: ${loc.quantity}`).join(', '),
        total_quantity: row.total_quantity,
      };
    });
    exportToExcel(rows, 'inventory.xlsx', 'Inventory');
    setInventoryActionStatus('');
  }

  async function fetchAllHistoryForExport() {
    const pageSize = 200;
    let page = 1;
    let total = Number.MAX_SAFE_INTEGER;
    const rows: HistoryRow[] = [];
    while ((page - 1) * pageSize < total) {
      const params = new URLSearchParams();
      if (historyFilters.from) params.set('startDate', historyFilters.from);
      if (historyFilters.to) params.set('endDate', historyFilters.to);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/history?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        console.error('history export fetch failed', { step: 'history_export_fetch', page, status: res.status });
        break;
      }
      const payload = await res.json().catch(() => null);
      if (!payload?.ok) {
        console.error('history export fetch failed', { step: 'history_export_fetch', page, payload });
        break;
      }
      const list = Array.isArray(payload?.rows) ? payload.rows : [];
      rows.push(
        ...list.map((row: any) => ({
          ...row,
          option: row.option ?? '',
          created_by_name: row.created_by_name ?? '',
          created_by_department: row.created_by_department ?? '',
        }))
      );
      total = payload?.page?.totalRows ?? rows.length;
      page += 1;
      if (list.length < pageSize) break;
    }
    return rows;
  }

  async function exportHistory() {
    const allRows = await fetchAllHistoryForExport();
    const matchesSearch = (row: HistoryRow) =>
      [
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
    const filtered = allRows.filter((row) => {
      const matchesDirection = !historyFilters.direction || row.direction === historyFilters.direction;
      const matchesCategory = !historyFilters.category || row.category === historyFilters.category;
      return matchesDirection && matchesCategory && matchesSearch(row);
    });
    const rows = filtered.map((h) => ({
      created_at_kst: formatDate(h.created_at),
      direction: h.direction,
      artist: h.artist,
      category: h.category,
      album_version: h.album_version,
      option: h.option ?? '',
      location: h.location,
      quantity: h.quantity,
      created_by_name: h.created_by_name || '-',
      created_by_department: h.created_by_department ?? '',
      memo: h.memo ?? ''
    }));
    exportToExcel(rows, `history-${historyFilters.from}-${historyFilters.to}.xlsx`, 'History');
  }

  const totalQuantity = inventoryMeta.summary.totalQuantity;
  const distinctItems = inventoryMeta.summary.uniqueItems;
  const locationBreakdown = useMemo(() => {
    const fromSummary = Object.entries(inventoryMeta.summary.byLocation || {}).sort(
      (a, b) => Number(b[1]) - Number(a[1])
    );
    if (fromSummary.length > 0) return fromSummary;

    const aggregate = new Map<string, number>();
    filteredStock.forEach((row) => {
      row.locations.forEach((loc) => {
        aggregate.set(loc.location, (aggregate.get(loc.location) ?? 0) + Number(loc.quantity ?? 0));
      });
    });
    return Array.from(aggregate.entries()).sort((a, b) => Number(b[1]) - Number(a[1]));
  }, [filteredStock, inventoryMeta.summary.byLocation]);
  const totalPages = Math.max(1, Math.ceil((inventoryPage.totalRows || 0) / inventoryPage.limit));
  const currentPage = Math.min(totalPages, Math.floor(inventoryPage.offset / inventoryPage.limit) + 1);
  const canPrevPage = inventoryPage.offset > 0;
  const canNextPage = inventoryPage.offset + inventoryPage.limit < inventoryPage.totalRows;
  const transferBlockedForScope =
    (sessionRole === 'l_operator' || sessionRole === 'manager') &&
    (!sessionScope?.primary_location || (sessionScope.sub_locations ?? []).length === 0);
  const bulkTransferAllowed =
    sessionRole === 'admin' || sessionRole === 'operator' || sessionRole === 'l_operator' || sessionRole === 'manager';

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
    if ((sessionRole === 'l_operator' || sessionRole === 'manager') && sessionScope?.primary_location) {
      setTransferPayload((prev) => ({ ...prev, from_location: sessionScope.primary_location ?? '' }));
    }
  }, [sessionRole, sessionScope]);

  useEffect(() => {
    if (activePanel !== 'stock') return;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Enter') {
        const captured = barcodeBufferRef.current;
        barcodeBufferRef.current = '';
        if (barcodeTimerRef.current) {
          clearTimeout(barcodeTimerRef.current);
          barcodeTimerRef.current = null;
        }
        if (captured) {
          applyBarcodeScan(captured);
        }
        return;
      }
      if (event.key.length === 1) {
        barcodeBufferRef.current += event.key;
        if (barcodeTimerRef.current) {
          clearTimeout(barcodeTimerRef.current);
        }
        barcodeTimerRef.current = setTimeout(() => {
          barcodeBufferRef.current = '';
          barcodeTimerRef.current = null;
        }, 200);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activePanel, applyBarcodeScan]);

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
    if (activePanel === 'history') {
      reloadHistory();
    }
  }, [activePanel]);

  useEffect(() => {
    setHistoryPage((prev) => ({ ...prev, page: 1 }));
    if (activePanel === 'history') {
      reloadHistory({ page: 1 });
    }
  }, [historyFilters.from, historyFilters.to]);

  useEffect(() => {
    if (!focusedStockKey) {
      setEditDraft(null);
      return;
    }
    const match = stock.find((row) => row.key === focusedStockKey);
    const defaultLocation = match?.locations?.[0];
    if (match && defaultLocation) {
      setEditDraft({
        id: defaultLocation.editableId ?? defaultLocation.id,
        artist: match.artist,
        category: match.category,
        album_version: match.album_version,
        option: match.option,
        barcode: match.barcode ?? '',
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
    if (activePanel !== 'stock') {
      setMobileFormOpen(false);
    }
  }, [activePanel]);

  const selectionDisabled = sessionRole === 'operator';

  useEffect(() => {
    if (selectionDisabled) {
      setEditPanelEnabled(false);
      setSelectedStockKeys([]);
      setFocusedStockKey(null);
    }
  }, [selectionDisabled]);

  useEffect(() => {
    fetchSessionInfo();
    refresh();
    }, []);

  const movementPanelContent = (
    <>
      <div className="mode-toggle">
        <button
          type="button"
          className={activeTab === 'movement' ? 'primary' : 'ghost'}
          onClick={() => {
            setActiveTab('movement');
            setTransferPayload(EMPTY_TRANSFER);
          }}
        >
          입/출고
        </button>
        <button
          type="button"
          className={activeTab === 'transfer' ? 'primary' : 'ghost'}
          onClick={() => {
            setActiveTab('transfer');
            setMovement(EMPTY_MOVEMENT);
            resetTransferForm();
          }}
        >
          전산이관
        </button>
        <button
          type="button"
          className={activeTab === 'bulk_transfer' ? 'primary' : 'ghost'}
          onClick={() => setActiveTab('bulk_transfer')}
          disabled={!bulkTransferAllowed}
          title={bulkTransferAllowed ? undefined : '일괄 이관 권한 필요'}
        >
          일괄이관
        </button>
      </div>

      {activeTab === 'movement' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMovement('IN');
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
              <span>바코드</span>
              <input
                value={movement.barcode || ''}
                onChange={(e) => setMovement({ ...movement, barcode: e.target.value })}
                placeholder="바코드 (MD 권장)"
                disabled={movementBarcodeLocked}
                readOnly={movementBarcodeLocked}
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
              <span>메모 (필수)</span>
              <input
                value={movement.memo}
                onChange={(e) => setMovement({ ...movement, memo: e.target.value })}
                placeholder="작업 사유/비고"
              />
            </label>
          </div>
          <div className="actions-row">
            <button type="button" disabled={isSubmitting} onClick={() => submitMovement('IN')}>
              {isSubmitting && activeTab === 'movement' ? '처리 중...' : '입고'}
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              className="secondary"
              onClick={() => submitMovement('OUT')}
            >
              {isSubmitting && activeTab === 'movement' ? '처리 중...' : '출고'}
            </button>
          </div>
        </form>
      ) : activeTab === 'transfer' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitTransfer();
          }}
        >
          <div className="form-row">
            <label>
              <span>아티스트</span>
              <input
                value={transferPayload.artist}
                onChange={(e) => setTransferPayload({ ...transferPayload, artist: e.target.value })}
                placeholder="예: ARTIST"
              />
            </label>
            <label className="compact">
              <span>카테고리</span>
              <select
                value={transferPayload.category}
                onChange={(e) =>
                  setTransferPayload({ ...transferPayload, category: e.target.value as TransferPayload['category'] })
                }
              >
                <option value="album">앨범</option>
                <option value="md">MD</option>
              </select>
            </label>
            <label>
              <span>앨범/버전</span>
              <input
                value={transferPayload.album_version}
                onChange={(e) => setTransferPayload({ ...transferPayload, album_version: e.target.value })}
                placeholder="앨범명/버전"
              />
            </label>
            <label>
              <span>옵션</span>
              <input
                value={transferPayload.option}
                onChange={(e) => setTransferPayload({ ...transferPayload, option: e.target.value })}
                placeholder="포카/키트 등"
              />
            </label>
            <label>
              <span>바코드</span>
              <input
                value={transferPayload.barcode || ''}
                onChange={(e) => setTransferPayload({ ...transferPayload, barcode: e.target.value })}
                placeholder="바코드 (MD 권장)"
                disabled={transferBarcodeLocked}
                readOnly={transferBarcodeLocked}
              />
            </label>
            <label>
              <span>수량</span>
              <input
                type="number"
                value={transferPayload.quantity}
                min={1}
                onChange={(e) => setTransferPayload({ ...transferPayload, quantity: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              <span>보내는 곳</span>
              <input
                list="location-options"
                value={
                  (sessionRole === 'l_operator' || sessionRole === 'manager') && sessionScope?.primary_location
                    ? sessionScope.primary_location
                    : transferPayload.from_location
                }
                disabled={
                  (sessionRole === 'l_operator' || sessionRole === 'manager') && !!sessionScope?.primary_location
                }
                onChange={(e) => setTransferPayload({ ...transferPayload, from_location: e.target.value })}
                placeholder="출발 로케이션"
              />
            </label>
            <label>
              <span>받는 곳</span>
              <select
                value={transferPayload.to_location}
                onChange={(e) => setTransferPayload({ ...transferPayload, to_location: e.target.value })}
                disabled={
                  sessionRole === 'l_operator' || sessionRole === 'manager'
                    ? !sessionScope?.sub_locations || sessionScope.sub_locations.length === 0
                    : locationOptions.length === 0
                }
              >
                <option value="" disabled>
                  {sessionRole === 'l_operator' || sessionRole === 'manager'
                    ? sessionScope?.sub_locations && sessionScope.sub_locations.length > 0
                      ? '받는 곳 선택'
                      : '서브 로케이션 없음'
                    : locationOptions.length > 0
                    ? '받는 곳 선택'
                    : '로케이션 없음'}
                </option>
                {(sessionRole === 'l_operator' || sessionRole === 'manager'
                  ? sessionScope?.sub_locations ?? []
                  : locationOptions
                ).map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="wide">
              <span>메모 (필수)</span>
              <input
                value={transferPayload.memo}
                onChange={(e) => setTransferPayload({ ...transferPayload, memo: e.target.value })}
                placeholder="작업 사유/비고"
              />
            </label>
          </div>
          <div className="actions-row">
            <button
              type="button"
              disabled={isSubmitting || transferBlockedForScope || !transferPayload.memo.trim()}
              onClick={submitTransfer}
            >
              {transferBlockedForScope
                ? '서브 로케이션 필요'
                : isSubmitting && activeTab === 'transfer'
                ? '처리 중...'
                : '전산이관'}
            </button>
            <button type="button" className="ghost" onClick={resetTransferForm}>
              초기화
            </button>
          </div>
        </form>
      ) : activeTab === 'bulk_transfer' ? (
        <BulkTransferPanel
          selectedItems={bulkSelectedRows}
          availableToLocations={
            sessionRole === 'l_operator' || sessionRole === 'manager'
              ? sessionScope?.sub_locations ?? []
              : locationOptions
          }
          role={sessionRole}
          sessionScope={sessionScope}
          onDone={async () => {
            await Promise.all([
              reloadInventory({ suppressErrors: true }),
              reloadHistory({ suppressErrors: true }),
            ]);
          }}
          onClearSelection={clearBulkSelection}
          onSelectAll={() => selectAllBulk(filteredStock)}
        />
      ) : null}
    </>
  );

  const movementPanel = (
    <Section
      title="입/출고 등록"
      actions={
        <div className="section-actions">
          <button className="ghost" onClick={() => setMovement(EMPTY_MOVEMENT)}>입력값 초기화</button>
        </div>
      }
    >
      {movementPanelContent}
    </Section>
  );

  return (
    <>
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
          disabled={selectionDisabled}
          onClick={() => {
            if (selectionDisabled) return;
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

      <div className={`mobile-form-modal ${mobileFormOpen ? 'open' : ''}`} aria-hidden={!mobileFormOpen}>
        <div className="mobile-form-sheet">
          <div className="mobile-form-header">
            <strong>입/출고 등록</strong>
            <div className="actions-row">
              <button type="button" className="ghost" onClick={() => setMovement(EMPTY_MOVEMENT)}>
                입력값 초기화
              </button>
              <button type="button" className="ghost" onClick={() => setMobileFormOpen(false)}>
                닫기
              </button>
            </div>
          </div>
          {movementPanelContent}
        </div>
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
          <div className="left-sticky desktop-only">
            {movementPanel}
          </div>
          <div className="right-panel">
            <Section
              title="현재 재고"
              actions={
                <div className="filter-row">
                  <form className="filter-row inventory-filters" onSubmit={handleInventorySearchSubmit}>
                    <div className="filter-stack primary-stack">
                      <input
                        className="inline-input"
                        placeholder="검색 (아티스트/버전/옵션/위치)"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                      <input
                        className="inline-input"
                        placeholder="앨범/버전"
                        value={albumVersionTerm}
                        onChange={(e) => setAlbumVersionTerm(e.target.value)}
                      />
                      <input
                        className="inline-input"
                        placeholder="바코드"
                        value={barcodeTerm}
                        onChange={(e) => setBarcodeTerm(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleInventorySearchSubmit(e);
                          }
                        }}
                      />
                      <button className="primary" type="submit">
                        검색
                      </button>
                      <button className="ghost" type="button" onClick={resetInventorySearch}>
                        초기화
                      </button>
                    </div>
                    <div className="filter-stack wrap secondary-stack">
                      <select
                        className="scroll-select"
                        value={stockFilters.artist}
                        onChange={(e) => applyInventoryFilters({ ...stockFilters, artist: e.target.value })}
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
                        value={stockFilters.category}
                        onChange={(e) => applyInventoryFilters({ ...stockFilters, category: e.target.value })}
                      >
                        <option value="">전체 카테고리</option>
                        {categoryOptions.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <select
                        className="scroll-select"
                        value={stockFilters.location}
                        onChange={(e) => applyInventoryFilters({ ...stockFilters, location: e.target.value })}
                      >
                        <option value="">전체 로케이션</option>
                        {filterLocationOptions.map((loc) => (
                          <option key={loc} value={loc}>
                            {loc}
                          </option>
                        ))}
                      </select>
                      <button className="ghost" type="button" onClick={exportInventory}>
                        엑셀 다운로드
                      </button>
                    </div>
                  </form>
                </div>
              }
            >
              <div className="alert-row">
                <button
                  type="button"
                  className={showAnomalies ? 'warning-button active' : 'warning-button'}
                  disabled={anomalyCount === 0}
                  onClick={() => {
                    if (anomalyCount === 0) return;
                    setShowAnomalies((prev) => !prev);
                  }}
                >
                  이상재고 {anomalyCount}건
                </button>
                <span className="muted small-text">음수 수량만 따로 모아 볼 수 있습니다.</span>
              </div>
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
                  <div className="pill-row wrap">
                    {locationBreakdown.length === 0 && <span className="muted">로케이션 정보가 없습니다.</span>}
                    {locationBreakdown.map(([loc, qty]) => (
                      <Pill key={loc}>
                        {loc}: {qty.toLocaleString()}
                      </Pill>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bulk-toggle-row">
                <button
                  type="button"
                  className={activeTab === 'bulk_transfer' ? 'primary' : 'ghost'}
                  disabled={!bulkTransferAllowed}
                  onClick={() => setActiveTab('bulk_transfer')}
                  title={bulkTransferAllowed ? undefined : '일괄 이관 권한 필요'}
                >
                  일괄 이관 탭으로 이동
                </button>
                <span className="muted small-text">복수 항목을 선택해 전량 이관할 수 있습니다.</span>
              </div>
              <div className="inventory-cards">
                <div className="inventory-cards-header">
                  <strong>현재 재고</strong>
                  <button type="button" className="ghost" onClick={() => setMobileFormOpen(true)}>
                    입/출고 등록 열기
                  </button>
                </div>
                {filteredStock.length === 0 && (
                  <div className="muted">표시할 재고가 없습니다.</div>
                )}
                {filteredStock.map((row) => (
                  <button
                    type="button"
                    key={`card-${row.key}`}
                    className="inventory-card"
                    onClick={() => {
                      applyStockRowToForms(row);
                      setMobileFormOpen(true);
                    }}
                  >
                    <div className="inventory-card-header">
                      <div>
                        <strong>{row.artist}</strong>
                        <div className="muted small-text">{row.album_version}</div>
                      </div>
                      <div className="inventory-card-qty">
                        {row.total_quantity.toLocaleString()}개
                      </div>
                    </div>
                    <div className="inventory-card-body">
                      <div>옵션: {row.option || '-'}</div>
                      <div>바코드: {row.barcode || '-'}</div>
                      <div className="inventory-card-locations">
                        {row.locations.map((loc) => (
                          <span key={`${row.key}-${loc.id}`} className="pill">
                            {loc.location}: {loc.quantity.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="table-wrapper responsive-table inventory-table">
                <table className="table">
                  <thead>
                    <tr>
                      {activeTab === 'bulk_transfer' && <th className="bulk-check-column">선택</th>}
                      <th>아티스트</th>
                      <th>카테고리</th>
                      <th>앨범/버전</th>
                      <th>옵션</th>
                      <th>바코드</th>
                      <th>로케이션</th>
                      <th className="align-right">현재고</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStock.map((row) => (
                      <React.Fragment key={row.key}>
                        <tr
                          className={[
                            selectedStockKeys.includes(row.key) ? 'selected-row' : '',
                            bulkSelectedKeys.includes(row.key) ? 'bulk-selected-row' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            if (activeTab === 'bulk_transfer') {
                              toggleBulkSelection(row.key);
                              return;
                            }
                            handleStockClick(row);
                          }}
                          onDoubleClick={() => {
                            if (activeTab === 'bulk_transfer') return;
                            handleStockDoubleClick(row);
                          }}
                        >
                          {activeTab === 'bulk_transfer' && (
                            <td className="bulk-check-cell">
                              <label className="bulk-check-label">
                                <input
                                  type="checkbox"
                                  checked={bulkSelectedKeys.includes(row.key)}
                                  onChange={() => toggleBulkSelection(row.key)}
                                  aria-label={`${row.artist} ${row.album_version} 선택`}
                                />
                                <span className="bulk-check-text">선택</span>
                              </label>
                            </td>
                          )}
                          <td>{row.artist}</td>
                          <td>{row.category}</td>
                          <td>{row.album_version}</td>
                          <td>{row.option}</td>
                          <td title={row.barcode ?? ''}>{row.barcode || '-'}</td>
                          <td>
                            <div className="pill-row wrap">
                              {row.locations.map((loc) => (
                                <button
                                  key={`${row.key}-${loc.id}`}
                                  className="ghost small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (activeTab === 'bulk_transfer') return;
                                  if (selectionDisabled) return;
                                  setSelectedStockKeys((prev) =>
                                    prev.includes(row.key) ? prev : [...prev, row.key]
                                  );
                                  setFocusedStockKey(row.key);
                                  setEditDraft({
                                    id: loc.editableId ?? loc.id,
                                    artist: row.artist,
                                    category: row.category,
                                    album_version: row.album_version,
                                    option: row.option,
                                    barcode: row.barcode ?? '',
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
                            ) : selectionDisabled ? (
                              <span className="muted">선택 편집 불가</span>
                            ) : (
                              <div className="row-actions">
                                <button
                                  className="ghost small"
                                  disabled={activeTab === 'bulk_transfer'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (activeTab === 'bulk_transfer') return;
                                    setSelectedStockKeys((prev) =>
                                      prev.includes(row.key) ? prev : [...prev, row.key]
                                    );
                                    const loc = row.locations[0];
                                    if (loc) {
                                      setFocusedStockKey(row.key);
                                      setEditDraft({
                                        id: loc.editableId ?? loc.id,
                                        artist: row.artist,
                                        category: row.category,
                                        album_version: row.album_version,
                                        option: row.option,
                                        barcode: row.barcode ?? '',
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
                                    disabled={activeTab === 'bulk_transfer'}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (activeTab === 'bulk_transfer') return;
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
                        {editPanelEnabled && !selectionDisabled && sessionRole !== 'viewer' && editDraft &&
                          focusedStockKey === row.key && (
                          <tr className="inline-editor-row">
                            <td colSpan={activeTab === 'bulk_transfer' ? 9 : 8}>
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
                                    <span>바코드</span>
                                    <input
                                      value={editDraft.barcode ?? ''}
                                      onChange={(e) => setEditDraft({ ...editDraft, barcode: e.target.value })}
                                      placeholder="바코드 (선택)"
                                      disabled={sessionRole !== 'admin' && Boolean(editDraft.barcode)}
                                      readOnly={sessionRole !== 'admin' && Boolean(editDraft.barcode)}
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
                                {editDraft.barcode && (
                                  <div className="barcode-panel">
                                    <span className="muted small-text">바코드 미리보기</span>
                                    <BarcodePreview value={editDraft.barcode} />
                                  </div>
                                )}
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
                <div className="pagination-row">
                  <span className="muted">
                    총 {inventoryPage.totalRows.toLocaleString()}건 · {currentPage}/{totalPages} 페이지
                  </span>
                  <div className="section-actions">
                    <button
                      className="ghost"
                      type="button"
                      disabled={!canPrevPage}
                      onClick={() => changeInventoryPage(inventoryPage.offset - inventoryPage.limit)}
                    >
                      이전
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      disabled={!canNextPage}
                      onClick={() => changeInventoryPage(inventoryPage.offset + inventoryPage.limit)}
                    >
                      다음
                    </button>
                  </div>
                </div>
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
              <option value="TRANSFER">전산이관</option>
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
            <button className="ghost" type="button" onClick={() => reloadHistory()}>
              새로고침
            </button>
            <button className="ghost" type="button" onClick={exportHistory}>
              엑셀 다운로드
            </button>
          </div>
        }
      >
        <p className="muted" style={{ margin: '0 0 0.5rem' }}>
          기본적으로 최근 15일 데이터를 한국시간 기준으로 보여주며, 달력으로 기간을 직접 선택하고 유형으로 필터링할 수 있습니다.
        </p>
        <div className="table-wrapper history-table-wrapper">
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
              {filteredHistory.map((h, idx) => {
                const displayLocation = h.location;
                const directionLabel = h.direction === 'TRANSFER' ? '전산이관' : h.direction;
                return (
                  <tr key={`${h.created_at}-${idx}`}>
                    <td>{formatDate(h.created_at)}</td>
                    <td>
                      <Pill>{directionLabel}</Pill>
                    </td>
                    <td>{h.artist}</td>
                    <td>{h.category}</td>
                    <td>{h.album_version}</td>
                    <td>{h.option}</td>
                    <td>{displayLocation}</td>
                    <td className="align-right">{h.quantity.toLocaleString()}</td>
                    <td className="align-center">
                      <div className="stacked-label">
                        <strong>{h.created_by_name || h.created_by || '-'}</strong>
                        <span className="muted small-text">{h.created_by_department || '부서 정보 없음'}</span>
                      </div>
                    </td>
                    <td>{h.memo || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pagination-row">
          <span className="muted">
            총 {historyPage.totalRows.toLocaleString()}건 · {historyCurrentPage}/{historyTotalPages} 페이지
          </span>
          <div className="section-actions">
            <select
              className="compact"
              value={historyPage.pageSize}
              onChange={(e) => changeHistoryPageSize(Number(e.target.value))}
            >
              {[50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size}개
                </option>
              ))}
            </select>
            <button
              className="ghost"
              type="button"
              disabled={!historyCanPrev}
              onClick={() => changeHistoryPage(historyCurrentPage - 1)}
            >
              이전
            </button>
            <button
              className="ghost"
              type="button"
              disabled={!historyCanNext}
              onClick={() => changeHistoryPage(historyCurrentPage + 1)}
            >
              다음
            </button>
          </div>
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
          <div className="modal-card wide-modal">
            <div className="section-heading sticky-header">
              <h3>계정 관리</h3>
              <div className="section-actions">
                <button className="ghost" onClick={loadAccounts}>새로고침</button>
                <button className="ghost" onClick={closeAccountManager}>닫기</button>
              </div>
            </div>
            <div className="account-modal-body">
              <p className="muted" style={{ marginTop: 0 }}>
                ID, 실명, 부서를 확인하고 권한과 승인 여부를 바로 수정할 수 있습니다.
              </p>
              {!locationScopeAvailable && (
                <div className="alert-row" style={{ marginBottom: '0.5rem' }}>
                  <strong>로케이션 범위 기능이 비활성화되었습니다.</strong>
                  <span className="muted">DB에 user_location_permissions 테이블이 없거나 준비 중입니다.</span>
                </div>
              )}
              <datalist id="locations-list">
                {locationOptions.map((loc) => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
              <div className="table-wrapper responsive-table account-table-wrapper">
                <table className="table compact-table account-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>이메일</th>
                      <th>성함</th>
                      <th>부서</th>
                      <th>연락처</th>
                      <th>사용 목적</th>
                      <th>권한</th>
                      <th>담당 로케이션</th>
                      <th>서브 로케이션</th>
                      <th>로케이션 저장</th>
                      <th>승인</th>
                      <th>생성일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.length === 0 && (
                      <tr>
                        <td colSpan={12}>계정 정보가 없습니다.</td>
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
                            <option value="manager">manager</option>
                            <option value="operator">operator</option>
                            <option value="l_operator">l-operator</option>
                            <option value="viewer">viewer</option>
                          </select>
                        </td>
                        <td>
                          {acc.role === 'l_operator' || acc.role === 'manager' ? (
                            <div className="location-input-group">
                              <input
                                className="inline-input"
                                placeholder="주 로케이션"
                                value={locationScopes[acc.id]?.primary ?? ''}
                                list="locations-list"
                                disabled={!locationScopeAvailable}
                                onChange={(e) =>
                                  setLocationScopes((prev) => ({
                                    ...prev,
                                    [acc.id]: { ...prev[acc.id], primary: e.target.value, subs: prev[acc.id]?.subs ?? '' },
                                  }))
                                }
                              />
                              {locationScopeAvailable && locationOptions.length > 0 && (
                                <div className="location-chip-row">
                                  {locationOptions.slice(0, 6).map((loc) => (
                                    <button
                                      key={`${acc.id}-primary-${loc}`}
                                      type="button"
                                      className="chip"
                                      onClick={() =>
                                        setLocationScopes((prev) => ({
                                          ...prev,
                                          [acc.id]: { ...prev[acc.id], primary: loc, subs: prev[acc.id]?.subs ?? '' },
                                        }))
                                      }
                                    >
                                      {loc}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>
                          {acc.role === 'l_operator' || acc.role === 'manager' ? (
                            <div className="location-input-group">
                              <input
                                className="inline-input"
                                placeholder="쉼표로 구분"
                                value={locationScopes[acc.id]?.subs ?? ''}
                                list="locations-list"
                                disabled={!locationScopeAvailable}
                                onChange={(e) =>
                                  setLocationScopes((prev) => ({
                                    ...prev,
                                    [acc.id]: { ...prev[acc.id], subs: e.target.value, primary: prev[acc.id]?.primary ?? '' },
                                  }))
                                }
                              />
                              {locationScopeAvailable && locationOptions.length > 0 && (
                                <div className="location-chip-row">
                                  {locationOptions.slice(0, 6).map((loc) => (
                                    <button
                                      key={`${acc.id}-subs-${loc}`}
                                      type="button"
                                      className="chip ghost-chip"
                                      onClick={() =>
                                        setLocationScopes((prev) => {
                                          const existing = (prev[acc.id]?.subs || '')
                                            .split(',')
                                            .map((v) => v.trim())
                                            .filter(Boolean);
                                          if (existing.includes(loc)) return prev;
                                          const combined = existing.length > 0 ? `${existing.join(', ')}, ${loc}` : loc;
                                          return {
                                            ...prev,
                                            [acc.id]: { ...prev[acc.id], subs: combined, primary: prev[acc.id]?.primary ?? '' },
                                          };
                                        })
                                      }
                                    >
                                      {loc}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>
                          {acc.role === 'l_operator' || acc.role === 'manager' ? (
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => saveAccountScope(acc.id)}
                              disabled={!locationScopeAvailable}
                              title={locationScopeAvailable ? undefined : '로케이션 범위 테이블이 없어 저장을 건너뜁니다'}
                            >
                              저장
                            </button>
                          ) : (
                            <span className="muted">-</span>
                          )}
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
              <div className="muted account-status-row">{accountsStatus}</div>
            </div>
          </div>
        </div>
      )}
    </main>
    <style jsx global>{`
      .inventory-filters {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.75rem;
        align-items: stretch;
      }

      .filter-stack {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }

      .primary-stack {
        width: 100%;
        flex-direction: column;
      }

      .filter-stack.wrap {
        justify-content: flex-start;
      }

      @media (min-width: 768px) {
        .inventory-filters {
          grid-template-columns: 2fr 1fr;
          align-items: flex-start;
        }
        .primary-stack,
        .secondary-stack {
          width: 100%;
          flex-direction: row;
        }
      }

      @media (max-width: 640px) {
        .inventory-filters .inline-input,
        .inventory-filters select,
        .inventory-filters button {
          width: 100%;
        }
        .filter-row.inventory-filters {
          align-items: stretch;
        }
        .secondary-stack {
          flex-direction: column;
          align-items: stretch;
        }
      }

      .responsive-table {
        overflow-x: auto;
      }

      .history-table-wrapper {
        max-height: 70vh;
        overflow: auto;
      }

      .modal-card.wide-modal {
        max-width: 95vw;
        width: 1280px;
        min-height: 75vh;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .wide-modal .section-heading {
        position: sticky;
        top: 0;
        background: #fff;
        z-index: 2;
      }

      .account-modal-body {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0 0.75rem 0.75rem;
      }

      .account-table-wrapper {
        max-height: 70vh;
        overflow: auto;
      }

      .account-table thead th {
        position: sticky;
        top: 0;
        background: #f8f8f8;
        z-index: 1;
      }

      .account-table {
        min-width: 1180px;
      }

      .account-table th:nth-child(7),
      .account-table td:nth-child(7) {
        min-width: 120px;
      }

      .account-status-row {
        padding: 0.25rem 0.35rem;
      }

      .location-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }

      .barcode-panel {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
        overflow-x: auto;
      }

      .barcode-preview {
        display: block;
        min-height: 80px;
        min-width: 280px;
        height: 80px;
        width: 100%;
        max-width: 520px;
        overflow-x: auto;
      }

      .location-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }

      .chip {
        border: 1px solid #e2e2e2;
        border-radius: 999px;
        padding: 0.2rem 0.55rem;
        background: #f7f7f7;
        font-size: 0.85rem;
        cursor: pointer;
      }

      .chip:hover {
        background: #eef2ff;
        border-color: #cdd4ff;
      }

      .ghost-chip {
        background: #fff;
      }

      .stats {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: 1fr;
      }

      .desktop-only {
        display: block;
      }

      .inventory-cards {
        display: none;
        flex-direction: column;
        gap: 0.75rem;
        margin: 0.75rem 0;
      }

      .inventory-cards-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }

      .inventory-card {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 0.75rem;
        background: #fff;
        text-align: left;
        cursor: pointer;
      }

      .inventory-card-header {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: flex-start;
      }

      .inventory-card-qty {
        font-weight: 700;
        color: #1f2937;
      }

      .inventory-card-body {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        color: #374151;
      }

      .inventory-card-locations {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }

      .mobile-form-modal {
        display: none;
      }

      .mobile-form-modal.open {
        display: flex;
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.5);
        align-items: stretch;
        justify-content: center;
        z-index: 50;
      }

      .mobile-form-sheet {
        background: #fff;
        width: 100vw;
        height: 100vh;
        padding: 1rem;
        overflow-y: auto;
      }

      .mobile-form-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }

      .bulk-toggle-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        margin: 0.75rem 0 0.5rem;
      }

      .bulk-check-column {
        width: 64px;
      }

      .bulk-check-cell {
        padding: 0;
      }

      .bulk-check-label {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        gap: 0.35rem;
        padding: 0.25rem;
        cursor: pointer;
      }

      .bulk-check-label input {
        width: 18px;
        height: 18px;
      }

      .bulk-check-text {
        font-size: 0.75rem;
        color: #333;
      }

      .bulk-selected-row {
        background: #eef5ff;
        outline: 2px solid #b7d4ff;
        outline-offset: -2px;
      }

      .bulk-transfer-panel {
        margin-top: 0.75rem;
        padding: 0.75rem;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #fff;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .bulk-transfer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .bulk-transfer-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }

      .bulk-transfer-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .bulk-transfer-item {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #f9fafb;
      }

      .bulk-transfer-item-main {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .bulk-transfer-item-input label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .bulk-transfer-error {
        color: #b42318;
        font-size: 0.75rem;
      }

      .bulk-transfer-footer {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        align-items: center;
      }

      .bulk-transfer-status {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }

      .bulk-transfer-report ul {
        margin: 0.25rem 0 0;
        padding-left: 1.1rem;
      }

      @media (min-width: 640px) {
        .stats {
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }
      }

      @media (max-width: 640px) {
        .section-actions {
          width: 100%;
        }

        .section-actions .filter-row {
          width: 100%;
        }

        .pill-row.wrap {
          gap: 0.35rem;
        }

        .desktop-only {
          display: none;
        }

        .inventory-table {
          display: none;
        }

        .inventory-cards {
          display: flex;
        }

        .mobile-form-sheet .form-row {
          flex-direction: column;
        }

        .mobile-form-sheet .form-row label,
        .mobile-form-sheet .form-row .inline-input,
        .mobile-form-sheet .form-row input,
        .mobile-form-sheet .form-row select,
        .mobile-form-sheet .form-row textarea {
          width: 100%;
        }
      }

      @media (max-width: 480px) {
        .filter-row .filter-stack button,
        .filter-row .filter-stack .inline-input,
        .filter-row .filter-stack select {
          flex: 1 1 100%;
        }

        .filter-row .filter-stack {
          justify-content: stretch;
        }

        .alert-row {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .bulk-transfer-summary {
          align-items: flex-start;
        }
      }
    `}</style>
    </>
  );
}
