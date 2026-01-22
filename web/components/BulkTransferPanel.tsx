'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Role } from '../lib/session';

type InventoryLocation = {
  location: string;
  quantity: number;
};

type InventoryItem = {
  key: string;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  barcode?: string | null;
  item_id?: string | null;
  locations: InventoryLocation[];
};

type SessionScope = {
  primary_location?: string | null;
  sub_locations?: string[];
} | null;

type LocationSelection = {
  selected: boolean;
  quantity: string;
};

type BulkTransferTask = {
  artist: string;
  category: 'album' | 'md';
  album_version: string;
  option: string;
  from_location: string;
  to_location: string;
  quantity: number;
  barcode?: string | null;
  item_id?: string | null;
};

type BulkTransferFailure = {
  item: BulkTransferTask;
  label: string;
  error: string;
};

type BulkTransferReport = {
  successCount: number;
  failureCount: number;
  failures: string[];
  failureItems: BulkTransferFailure[];
};

type BulkTransferPanelProps = {
  selectedItems: InventoryItem[];
  availablePrefixes: string[];
  role: Role | null;
  sessionScope: SessionScope;
  onDone: () => void | Promise<void>;
  onClearSelection: () => void;
  onSelectAll?: () => void;
};

function getLocationPrefix(location?: string | null) {
  const value = String(location ?? '').trim();
  if (!value) return '';
  const [prefix] = value.split('-');
  return prefix || value;
}

function replacePrefix(location: string, toPrefix: string) {
  const trimmed = location.trim();
  if (!trimmed) return toPrefix;
  const idx = trimmed.indexOf('-');
  if (idx === -1) return toPrefix;
  return `${toPrefix}${trimmed.slice(idx)}`;
}

function parseQuantity(value: string | undefined) {
  if (value === undefined || value.trim() === '') {
    return { kind: 'empty' as const };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { kind: 'invalid' as const };
  }
  return { kind: 'value' as const, value: parsed };
}

function normalizePrefixInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const [prefix] = trimmed.split('-');
  return (prefix || trimmed).trim().toUpperCase();
}

function formatItemLabel(item: InventoryItem) {
  return `${item.artist} / ${item.album_version} / ${item.option || '-'}`;
}

export default function BulkTransferPanel({
  selectedItems,
  availablePrefixes,
  role,
  sessionScope,
  onDone,
  onClearSelection,
  onSelectAll,
}: BulkTransferPanelProps) {
  const [fromPrefix, setFromPrefix] = useState('');
  const [toPrefix, setToPrefix] = useState('');
  const [memo, setMemo] = useState('');
  const [locationSelections, setLocationSelections] = useState<
    Record<string, Record<string, LocationSelection>>
  >({});
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<BulkTransferReport | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canTransfer =
    role === 'admin' || role === 'operator' || role === 'l_operator' || role === 'manager';

  const normalizedFromPrefix = fromPrefix.trim();
  const normalizedToPrefix = toPrefix.trim();

  const itemPrefixes = useMemo(() => {
    const map = new Map<string, string[]>();
    selectedItems.forEach((item) => {
      const prefixes = Array.from(
        new Set(item.locations.map((loc) => getLocationPrefix(loc.location)).filter(Boolean))
      ).sort();
      map.set(item.key, prefixes);
    });
    return map;
  }, [selectedItems]);

  const scopeConstraints = useMemo(() => {
    if (role !== 'l_operator' && role !== 'manager') {
      return { fromPrefix: '', toPrefixes: [] as string[] };
    }
    const primaryPrefix = getLocationPrefix(sessionScope?.primary_location ?? '');
    const toPrefixes = Array.from(
      new Set(
        (sessionScope?.sub_locations ?? [])
          .map((loc) => getLocationPrefix(loc))
          .filter(Boolean)
      )
    ).sort();
    return { fromPrefix: primaryPrefix, toPrefixes };
  }, [role, sessionScope]);

  const fromPrefixOptions = useMemo(() => {
    if ((role === 'l_operator' || role === 'manager') && scopeConstraints.fromPrefix) {
      return [scopeConstraints.fromPrefix];
    }
    return availablePrefixes;
  }, [availablePrefixes, role, scopeConstraints.fromPrefix]);

  const toPrefixOptions = useMemo(() => {
    if ((role === 'l_operator' || role === 'manager') && scopeConstraints.toPrefixes.length > 0) {
      return scopeConstraints.toPrefixes;
    }
    return availablePrefixes;
  }, [availablePrefixes, role, scopeConstraints.toPrefixes]);

  useEffect(() => {
    setLocationSelections((prev) => {
      if (!normalizedFromPrefix) return {};
      const next: Record<string, Record<string, LocationSelection>> = {};
      selectedItems.forEach((item) => {
        const matching = item.locations.filter(
          (loc) => getLocationPrefix(loc.location) === normalizedFromPrefix
        );
        if (matching.length === 0) return;
        const existing = prev[item.key] ?? {};
        const itemSelections: Record<string, LocationSelection> = {};
        matching.forEach((loc) => {
          itemSelections[loc.location] = existing[loc.location] ?? { selected: true, quantity: '' };
        });
        next[item.key] = itemSelections;
      });
      return next;
    });
  }, [normalizedFromPrefix, selectedItems]);

  const locationQuantityLookup = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    selectedItems.forEach((item) => {
      const locMap = new Map<string, number>();
      item.locations.forEach((loc) => {
        locMap.set(loc.location, Number(loc.quantity ?? 0));
      });
      map.set(item.key, locMap);
    });
    return map;
  }, [selectedItems]);

  const fromPrefixFailures = useMemo(() => {
    if (!normalizedFromPrefix) return [];
    return selectedItems
      .map((item) => {
        const prefixes = itemPrefixes.get(item.key) ?? [];
        const matches = prefixes.includes(normalizedFromPrefix);
        return matches
          ? null
          : {
              item,
              prefixes,
              reason: `from prefix '${normalizedFromPrefix}' 미할당`,
            };
      })
      .filter(Boolean) as { item: InventoryItem; prefixes: string[]; reason: string }[];
  }, [itemPrefixes, normalizedFromPrefix, selectedItems]);

  const selectionPlan = useMemo(() => {
    const locationErrors: Record<string, Record<string, string>> = {};
    const missingSelectionKeys: string[] = [];
    const tasks: BulkTransferTask[] = [];

    if (!normalizedFromPrefix) {
      return { locationErrors, missingSelectionKeys, tasks };
    }

    selectedItems.forEach((item) => {
      const matchingLocations = item.locations.filter(
        (loc) => getLocationPrefix(loc.location) === normalizedFromPrefix
      );
      if (matchingLocations.length === 0) return;
      const selections = locationSelections[item.key] ?? {};
      let selectedCount = 0;
      matchingLocations.forEach((loc) => {
        const selection = selections[loc.location];
        if (!selection?.selected) return;
        selectedCount += 1;
        const available = Number(loc.quantity ?? 0);
        if (!Number.isFinite(available) || available <= 0) {
          locationErrors[item.key] = {
            ...(locationErrors[item.key] ?? {}),
            [loc.location]: '현재고가 0 이하입니다.',
          };
          return;
        }
        const parsed = parseQuantity(selection.quantity);
        if (parsed.kind === 'invalid') {
          locationErrors[item.key] = {
            ...(locationErrors[item.key] ?? {}),
            [loc.location]: '정수만 입력할 수 있습니다.',
          };
          return;
        }

        const requestedQuantity =
          parsed.kind === 'value' ? parsed.value : Math.max(0, Math.floor(available));

        if (requestedQuantity < 0) {
          locationErrors[item.key] = {
            ...(locationErrors[item.key] ?? {}),
            [loc.location]: '0 이상만 입력할 수 있습니다.',
          };
          return;
        }
        if (requestedQuantity > available) {
          locationErrors[item.key] = {
            ...(locationErrors[item.key] ?? {}),
            [loc.location]: '현재고를 초과할 수 없습니다.',
          };
          return;
        }
        if (requestedQuantity === 0) {
          return;
        }

        tasks.push({
          artist: item.artist,
          category: (item.category as 'album' | 'md') ?? 'album',
          album_version: item.album_version,
          option: item.option ?? '',
          from_location: loc.location,
          to_location: replacePrefix(loc.location, normalizedToPrefix),
          quantity: requestedQuantity,
          barcode: item.barcode ?? null,
          item_id: item.item_id ?? null,
        });
      });

      if (selectedCount === 0) {
        missingSelectionKeys.push(item.key);
      }
    });

    return { locationErrors, missingSelectionKeys, tasks };
  }, [locationSelections, normalizedFromPrefix, normalizedToPrefix, selectedItems]);

  const scopeErrors = useMemo(() => {
    const errors: string[] = [];
    if (role !== 'l_operator' && role !== 'manager') return errors;
    if (!scopeConstraints.fromPrefix) {
      errors.push('담당 로케이션이 지정되지 않아 전산이관을 진행할 수 없습니다.');
      return errors;
    }
    if (normalizedFromPrefix && normalizedFromPrefix !== scopeConstraints.fromPrefix) {
      errors.push(`보내는 곳은 ${scopeConstraints.fromPrefix} prefix로만 가능합니다.`);
    }
    if (normalizedToPrefix && !scopeConstraints.toPrefixes.includes(normalizedToPrefix)) {
      errors.push('받는 곳은 서브 로케이션 prefix 중에서만 선택할 수 있습니다.');
    }
    return errors;
  }, [normalizedFromPrefix, normalizedToPrefix, role, scopeConstraints]);

  const hasLocationErrors = Object.keys(selectionPlan.locationErrors).length > 0;
  const hasMissingSelections = selectionPlan.missingSelectionKeys.length > 0;
  const hasFromPrefixFailures = fromPrefixFailures.length > 0;

  const canSubmit =
    canTransfer &&
    selectedItems.length > 0 &&
    normalizedFromPrefix &&
    normalizedToPrefix &&
    memo.trim() &&
    !isSubmitting &&
    !hasLocationErrors &&
    !hasMissingSelections &&
    !hasFromPrefixFailures &&
    scopeErrors.length === 0;

  const resetQuantities = () => {
    setLocationSelections((prev) => {
      const next: Record<string, Record<string, LocationSelection>> = {};
      Object.entries(prev).forEach(([itemKey, entries]) => {
        const nextEntries: Record<string, LocationSelection> = {};
        Object.entries(entries).forEach(([location, selection]) => {
          nextEntries[location] = { ...selection, quantity: '' };
        });
        next[itemKey] = nextEntries;
      });
      return next;
    });
  };

  const fillSelectedQuantities = () => {
    setLocationSelections((prev) => {
      const next: Record<string, Record<string, LocationSelection>> = {};
      Object.entries(prev).forEach(([itemKey, entries]) => {
        const nextEntries: Record<string, LocationSelection> = {};
        Object.entries(entries).forEach(([location, selection]) => {
          const available = locationQuantityLookup.get(itemKey)?.get(location) ?? 0;
          nextEntries[location] = selection.selected
            ? { ...selection, quantity: String(Math.max(0, Math.floor(available))) }
            : selection;
        });
        next[itemKey] = nextEntries;
      });
      return next;
    });
  };

  const toggleLocationSelection = (itemKey: string, location: string) => {
    setLocationSelections((prev) => ({
      ...prev,
      [itemKey]: {
        ...(prev[itemKey] ?? {}),
        [location]: {
          selected: !(prev[itemKey]?.[location]?.selected ?? false),
          quantity: prev[itemKey]?.[location]?.quantity ?? '',
        },
      },
    }));
  };

  const updateLocationQuantity = (itemKey: string, location: string, value: string) => {
    setLocationSelections((prev) => ({
      ...prev,
      [itemKey]: {
        ...(prev[itemKey] ?? {}),
        [location]: {
          selected: prev[itemKey]?.[location]?.selected ?? true,
          quantity: value,
        },
      },
    }));
  };

  const executeTransfers = async (items: BulkTransferTask[], baseKey: string) => {
    let successCount = 0;
    const failures: BulkTransferFailure[] = [];

    for (const item of items) {
      const itemIdLabel = item.item_id ?? `${item.artist}-${item.album_version}-${item.option || '-'}`;
      const idempotencyKey = `${baseKey}:${itemIdLabel}:${item.from_location}:${item.to_location}:${item.quantity}`;
      console.info('bulk_transfer_item', {
        step: 'bulk_transfer_item',
        item_id: item.item_id,
        from: item.from_location,
        to: item.to_location,
        quantity: item.quantity,
      });
      try {
        const res = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artist: item.artist,
            category: item.category,
            album_version: item.album_version,
            option: item.option ?? '',
            fromLocation: item.from_location,
            toLocation: item.to_location,
            quantity: item.quantity,
            memo: memo.trim(),
            barcode: item.barcode ?? '',
            idempotencyKey,
          }),
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok || payload?.ok !== true) {
          const message = payload?.error || payload?.message || `전산이관 실패 (${res.status})`;
          console.error('bulk_error', {
            step: 'bulk_error',
            item_id: item.item_id,
            from: item.from_location,
            to: item.to_location,
            quantity: item.quantity,
            error: message,
          });
          const label = `${item.artist} / ${item.album_version} / ${item.option || '-'} (${item.from_location} → ${item.to_location})`;
          failures.push({ item, label, error: message });
        } else {
          successCount += 1;
        }
      } catch (err: any) {
        const message = err?.message || '전산이관 실패';
        console.error('bulk_error', {
          step: 'bulk_error',
          item_id: item.item_id,
          from: item.from_location,
          to: item.to_location,
          quantity: item.quantity,
          error: message,
        });
        const label = `${item.artist} / ${item.album_version} / ${item.option || '-'} (${item.from_location} → ${item.to_location})`;
        failures.push({ item, label, error: message });
      }
    }

    return { successCount, failures };
  };

  const submitBulkTransfer = async () => {
    if (!canTransfer) {
      alert('일괄 이관 권한이 없습니다.');
      return;
    }
    if (!normalizedFromPrefix) {
      alert('보내는 곳 prefix를 입력하세요.');
      return;
    }
    if (!normalizedToPrefix) {
      alert('받는 곳 prefix를 입력하세요.');
      return;
    }
    if (!memo.trim()) {
      alert('일괄 이관 메모는 필수입니다.');
      return;
    }
    if (selectedItems.length === 0) {
      alert('일괄 이관할 항목을 선택하세요.');
      return;
    }
    if (fromPrefixFailures.length > 0) {
      alert('from prefix가 적용되지 않는 항목이 있습니다.');
      return;
    }
    if (scopeErrors.length > 0) {
      alert(scopeErrors[0]);
      return;
    }
    if (hasLocationErrors || hasMissingSelections) {
      alert('세부 로케이션 선택 또는 수량 입력을 확인하세요.');
      return;
    }

    if (selectionPlan.tasks.length === 0) {
      alert('이관할 수량이 0인 항목은 자동으로 제외됩니다.');
      return;
    }

    if (!confirm(`${selectionPlan.tasks.length}건을 ${normalizedToPrefix}로 이관합니다. 계속할까요?`)) return;

    setIsSubmitting(true);
    setStatus('일괄 이관 처리 중...');
    setReport(null);

    try {
      const baseKey = `bulk-transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { successCount, failures } = await executeTransfers(selectionPlan.tasks, baseKey);
      const failureMessages = failures.map((failure) => `${failure.label}: ${failure.error}`);
      const failureCount = failures.length;

      setReport({
        successCount,
        failureCount,
        failures: failureMessages,
        failureItems: failures,
      });

      if (failureCount === 0) {
        setStatus(`일괄 이관 완료: ${successCount}건`);
        onClearSelection();
      } else {
        setStatus(`일괄 이관 완료: 성공 ${successCount}건 · 실패 ${failureCount}건`);
      }

      console.info('bulk_done', {
        step: 'bulk_done',
        successCount,
        failureCount,
      });

      resetQuantities();
      await onDone();
    } catch (err: any) {
      const message = err?.message || '일괄 이관 처리 중 오류가 발생했습니다.';
      console.error('bulk_error', { step: 'bulk_error', error: message });
      setStatus(`일괄 이관 실패: ${message}`);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const retryFailures = async () => {
    if (!report || report.failureItems.length === 0) return;
    if (!normalizedFromPrefix || !normalizedToPrefix) {
      alert('보내는 곳/받는 곳 prefix를 입력하세요.');
      return;
    }
    if (!memo.trim()) {
      alert('일괄 이관 메모는 필수입니다.');
      return;
    }
    if (scopeErrors.length > 0) {
      alert(scopeErrors[0]);
      return;
    }

    setStatus('실패 항목 재시도 중...');
    setReport(null);
    setIsSubmitting(true);

    try {
      const baseKey = `bulk-transfer-retry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const failureItems = report.failureItems.map((failure) => failure.item);
      const { successCount, failures } = await executeTransfers(failureItems, baseKey);
      const failureMessages = failures.map((failure) => `${failure.label}: ${failure.error}`);
      const failureCount = failures.length;

      setReport({
        successCount,
        failureCount,
        failures: failureMessages,
        failureItems: failures,
      });

      if (failureCount === 0) {
        setStatus(`재시도 완료: ${successCount}건`);
      } else {
        setStatus(`재시도 완료: 성공 ${successCount}건 · 실패 ${failureCount}건`);
      }

      console.info('bulk_done', {
        step: 'bulk_done',
        successCount,
        failureCount,
      });

      await onDone();
    } catch (err: any) {
      const message = err?.message || '일괄 이관 재시도 중 오류가 발생했습니다.';
      console.error('bulk_error', { step: 'bulk_error', error: message });
      setStatus(`재시도 실패: ${message}`);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bulk-transfer-panel">
      <div className="bulk-transfer-header">
        <div>
          <strong>일괄 이관</strong>
          <div className="muted small-text">
            선택 {selectedItems.length}건 · 미입력 시 해당 로케이션의 전체 수량을 이관합니다.
          </div>
        </div>
        <label className="compact">
          <span>선택된 항목</span>
          <input value={`${selectedItems.length}개`} readOnly />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>보내는 곳 (prefix)</span>
          <input
            list="bulk-from-prefix-options"
            value={fromPrefix}
            onChange={(e) => setFromPrefix(normalizePrefixInput(e.target.value))}
            placeholder="예: DA"
          />
          <datalist id="bulk-from-prefix-options">
            {fromPrefixOptions.map((prefix) => (
              <option key={`bulk-from-${prefix}`} value={prefix} />
            ))}
          </datalist>
        </label>
        <label>
          <span>받는 곳 (prefix)</span>
          <input
            list="bulk-to-prefix-options"
            value={toPrefix}
            onChange={(e) => setToPrefix(normalizePrefixInput(e.target.value))}
            placeholder="예: K1A"
          />
          <datalist id="bulk-to-prefix-options">
            {toPrefixOptions.map((prefix) => (
              <option key={`bulk-to-${prefix}`} value={prefix} />
            ))}
          </datalist>
        </label>
        <label className="wide">
          <span>메모 (필수)</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="일괄 이관 사유/비고"
          />
        </label>
      </div>
      {scopeErrors.length > 0 && (
        <div className="bulk-transfer-alert">
          {scopeErrors.map((message) => (
            <div key={message} className="bulk-transfer-error">
              {message}
            </div>
          ))}
        </div>
      )}
      {hasFromPrefixFailures && (
        <div className="bulk-transfer-alert">
          <strong>from prefix 적용 불가 품목</strong>
          <ul>
            {fromPrefixFailures.map((failure) => (
              <li key={failure.item.key}>
                {formatItemLabel(failure.item)}: {failure.reason}
                {failure.prefixes.length > 0 && (
                  <span className="muted"> (가능: {failure.prefixes.join(', ')})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="bulk-transfer-actions">
        <button type="button" className="ghost" onClick={onSelectAll} disabled={!onSelectAll}>
          전체 선택
        </button>
        <button type="button" className="ghost" onClick={onClearSelection}>
          선택 해제
        </button>
        <button type="button" className="ghost" onClick={fillSelectedQuantities}>
          선택 로케이션 전량 입력
        </button>
        <button type="button" className="ghost" onClick={resetQuantities}>
          입력값 초기화
        </button>
      </div>
      <div className="bulk-transfer-list">
        {selectedItems.length === 0 && (
          <div className="muted small-text">일괄 이관할 항목을 선택하세요.</div>
        )}
        {selectedItems.map((item) => {
          const prefixes = itemPrefixes.get(item.key) ?? [];
          const matchingLocations = normalizedFromPrefix
            ? item.locations.filter(
                (loc) => getLocationPrefix(loc.location) === normalizedFromPrefix
              )
            : [];
          const itemErrors = selectionPlan.locationErrors[item.key] ?? {};
          const missingSelection = selectionPlan.missingSelectionKeys.includes(item.key);
          return (
            <div key={`bulk-item-${item.key}`} className="bulk-transfer-item">
              <div className="bulk-transfer-item-main">
                <strong>{item.artist}</strong>
                <div className="muted small-text">
                  {item.album_version} / {item.option || '-'}
                </div>
                <div className="muted small-text">보유 prefix: {prefixes.join(', ') || '-'}</div>
                {normalizedFromPrefix && matchingLocations.length === 0 && (
                  <div className="bulk-transfer-error">from prefix 미보유</div>
                )}
                {missingSelection && (
                  <div className="bulk-transfer-error">세부 로케이션을 선택하세요.</div>
                )}
              </div>
              <div className="bulk-transfer-item-input">
                {normalizedFromPrefix ? (
                  matchingLocations.length > 0 ? (
                    <details className="bulk-location-details" open>
                      <summary>세부 로케이션 선택</summary>
                      <div className="bulk-location-list">
                        {matchingLocations.map((loc) => {
                          const selection = locationSelections[item.key]?.[loc.location];
                          const error = itemErrors[loc.location];
                          return (
                            <div key={`${item.key}-${loc.location}`} className="bulk-location-row">
                              <label className="bulk-location-check">
                                <input
                                  type="checkbox"
                                  checked={selection?.selected ?? false}
                                  onChange={() => toggleLocationSelection(item.key, loc.location)}
                                />
                                <span>{loc.location}</span>
                                <span className="muted">현재고 {Number(loc.quantity ?? 0).toLocaleString()}</span>
                              </label>
                              <div className="bulk-location-qty">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={selection?.quantity ?? ''}
                                  onChange={(e) =>
                                    updateLocationQuantity(item.key, loc.location, e.target.value)
                                  }
                                  placeholder="미입력=전량"
                                />
                                {error && <span className="bulk-transfer-error">{error}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ) : (
                    <div className="muted small-text">from prefix 로케이션이 없습니다.</div>
                  )
                ) : (
                  <div className="muted small-text">보내는 곳 prefix를 입력하세요.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="bulk-transfer-footer">
        <button type="button" className="primary" disabled={!canSubmit} onClick={submitBulkTransfer}>
          {isSubmitting ? '처리 중...' : '일괄 이관 실행'}
        </button>
        {report?.failureItems?.length ? (
          <button type="button" className="ghost" disabled={isSubmitting} onClick={retryFailures}>
            실패 항목 재시도
          </button>
        ) : null}
        <div className="bulk-transfer-status muted small-text">
          {status || '보내는 곳/받는 곳 prefix를 지정한 뒤 이관을 실행하세요.'}
          {report && (
            <div className="bulk-transfer-report">
              <strong>
                성공 {report.successCount}건 · 실패 {report.failureCount}건
              </strong>
              {report.failures.length > 0 && (
                <ul>
                  {report.failures.slice(0, 4).map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                  {report.failures.length > 4 && <li>외 {report.failures.length - 4}건</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
