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

type BulkTransferItem = {
  artist: string;
  category: 'album' | 'md';
  album_version: string;
  option: string;
  from_location: string;
  quantity: number;
  barcode?: string | null;
  item_id?: string | null;
};

type BulkTransferFailure = {
  item: BulkTransferItem;
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
  availableToLocations: string[];
  role: Role | null;
  sessionScope: SessionScope;
  onDone: () => void | Promise<void>;
  onClearSelection: () => void;
  onSelectAll?: () => void;
};

function getRowLocation(item: InventoryItem) {
  if (item.locations.length !== 1) return null;
  const location = item.locations[0];
  const quantity = Number(location?.quantity ?? 0);
  if (!location || !Number.isFinite(quantity)) return null;
  return { location, quantity };
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

export default function BulkTransferPanel({
  selectedItems,
  availableToLocations,
  role,
  sessionScope,
  onDone,
  onClearSelection,
  onSelectAll,
}: BulkTransferPanelProps) {
  const [toLocation, setToLocation] = useState('');
  const [memo, setMemo] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<BulkTransferReport | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canTransfer =
    role === 'admin' || role === 'operator' || role === 'l_operator' || role === 'manager';

  useEffect(() => {
    setQuantities((prev) => {
      const next: Record<string, string> = {};
      selectedItems.forEach((item) => {
        if (item.key in prev) {
          next[item.key] = prev[item.key];
        }
      });
      return next;
    });
  }, [selectedItems]);

  const quantityErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    selectedItems.forEach((item) => {
      const locationInfo = getRowLocation(item);
      if (!locationInfo) {
        errors[item.key] = '로케이션이 하나인 항목만 일괄 이관 가능합니다.';
        return;
      }
      const available = Number(locationInfo.quantity ?? 0);
      if (!Number.isFinite(available) || available <= 0) {
        errors[item.key] = '현재고가 0 이하입니다.';
        return;
      }
      if ((role === 'l_operator' || role === 'manager') && sessionScope?.primary_location) {
        if (locationInfo.location.location !== sessionScope.primary_location) {
          errors[item.key] = '담당 로케이션과 일치하지 않습니다.';
          return;
        }
      }
      const parsed = parseQuantity(quantities[item.key]);
      if (parsed.kind === 'invalid') {
        errors[item.key] = '정수만 입력할 수 있습니다.';
        return;
      }
      if (parsed.kind === 'value') {
        if (parsed.value < 0) {
          errors[item.key] = '0 이상만 입력할 수 있습니다.';
          return;
        }
        if (parsed.value > available) {
          errors[item.key] = '현재고를 초과할 수 없습니다.';
        }
      }
    });
    return errors;
  }, [quantities, role, selectedItems, sessionScope]);

  const hasQuantityErrors = Object.keys(quantityErrors).length > 0;

  const resetQuantities = () => setQuantities({});

  const fillAllQuantities = () => {
    const next: Record<string, string> = {};
    selectedItems.forEach((item) => {
      const locationInfo = getRowLocation(item);
      if (!locationInfo) return;
      next[item.key] = String(Math.max(0, Math.floor(locationInfo.quantity)));
    });
    setQuantities(next);
  };

  const buildTransferItems = () => {
    const invalidItems: InventoryItem[] = [];
    const items: BulkTransferItem[] = [];

    selectedItems.forEach((item) => {
      const locationInfo = getRowLocation(item);
      if (!locationInfo) {
        invalidItems.push(item);
        return;
      }
      const availableQuantity = Number(locationInfo.quantity ?? 0);
      if (!Number.isFinite(availableQuantity) || availableQuantity <= 0) {
        invalidItems.push(item);
        return;
      }
      if ((role === 'l_operator' || role === 'manager') && sessionScope?.primary_location) {
        if (locationInfo.location.location !== sessionScope.primary_location) {
          invalidItems.push(item);
          return;
        }
      }
      const parsed = parseQuantity(quantities[item.key]);
      if (parsed.kind === 'invalid') {
        invalidItems.push(item);
        return;
      }

      let requestedQuantity = availableQuantity;
      if (parsed.kind === 'value') {
        requestedQuantity = parsed.value;
      }

      if (requestedQuantity < 0 || requestedQuantity > availableQuantity) {
        invalidItems.push(item);
        return;
      }

      if (requestedQuantity === 0) {
        return;
      }

      items.push({
        artist: item.artist,
        category: (item.category as 'album' | 'md') ?? 'album',
        album_version: item.album_version,
        option: item.option ?? '',
        from_location: locationInfo.location.location,
        quantity: requestedQuantity,
        barcode: item.barcode ?? null,
        item_id: item.item_id ?? null,
      });
    });

    return { invalidItems, items };
  };

  const validateScope = () => {
    if (role !== 'l_operator' && role !== 'manager') return true;
    const primary = sessionScope?.primary_location?.trim();
    const subs = (sessionScope?.sub_locations ?? []).map((v) => v.trim()).filter(Boolean);
    if (!primary) {
      alert('담당 로케이션이 지정되지 않아 전산이관을 진행할 수 없습니다.');
      return false;
    }
    if (subs.length === 0 || !subs.includes(toLocation.trim())) {
      alert('받는 곳은 서브 로케이션 중에서만 선택할 수 있습니다.');
      return false;
    }
    return true;
  };

  const executeTransfers = async (items: BulkTransferItem[], baseKey: string) => {
    let successCount = 0;
    const failures: BulkTransferFailure[] = [];

    for (const item of items) {
      const itemIdLabel = item.item_id ?? `${item.artist}-${item.album_version}-${item.option || '-'}`;
      const idempotencyKey = `${baseKey}:${itemIdLabel}:${item.from_location}:${toLocation}:${item.quantity}`;
      console.info('bulk_transfer_item', {
        step: 'bulk_transfer_item',
        item_id: item.item_id,
        from: item.from_location,
        to: toLocation,
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
            toLocation,
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
            to: toLocation,
            quantity: item.quantity,
            error: message,
          });
          const label = `${item.artist} / ${item.album_version} / ${item.option || '-'} (${item.from_location})`;
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
          to: toLocation,
          quantity: item.quantity,
          error: message,
        });
        const label = `${item.artist} / ${item.album_version} / ${item.option || '-'} (${item.from_location})`;
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
    if (!toLocation.trim()) {
      alert('받는 곳을 선택하세요.');
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
    if (!validateScope()) return;

    console.info('bulk_prepare', {
      step: 'bulk_prepare',
      selectedCount: selectedItems.length,
      toLocation,
    });

    const { invalidItems, items } = buildTransferItems();

    console.info('bulk_validate', {
      step: 'bulk_validate',
      validCount: items.length,
      invalidCount: invalidItems.length,
    });

    if (invalidItems.length > 0) {
      alert(`복수 로케이션 또는 수량 입력 오류인 항목 ${invalidItems.length}개가 있습니다.`);
      return;
    }

    if (items.length === 0) {
      alert('이관할 수량이 0인 항목은 자동으로 제외됩니다.');
      return;
    }

    if (!confirm(`${items.length}개 항목을 ${toLocation}로 이관합니다. 계속할까요?`)) return;

    setIsSubmitting(true);
    setStatus('일괄 이관 처리 중...');
    setReport(null);

    try {
      const baseKey = `bulk-transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { successCount, failures } = await executeTransfers(items, baseKey);
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
    if (!toLocation.trim()) {
      alert('받는 곳을 선택하세요.');
      return;
    }
    if (!memo.trim()) {
      alert('일괄 이관 메모는 필수입니다.');
      return;
    }
    if (!validateScope()) return;

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
        <strong>일괄 이관</strong>
        <span className="muted small-text">
          미입력 시 해당 품목의 전체 수량을 이관합니다. 수량은 현재고를 초과할 수 없습니다.
        </span>
      </div>
      <div className="form-row">
        <label>
          <span>받는 곳</span>
          <select
            value={toLocation}
            onChange={(e) => setToLocation(e.target.value)}
            disabled={availableToLocations.length === 0}
          >
            <option value="" disabled>
              {availableToLocations.length > 0 ? '받는 곳 선택' : '로케이션 없음'}
            </option>
            {availableToLocations.map((loc) => (
              <option key={`bulk-inline-${loc}`} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
        <label className="compact">
          <span>선택된 항목</span>
          <input value={`${selectedItems.length}개`} readOnly />
        </label>
      </div>
      <div className="form-row">
        <label className="wide">
          <span>메모 (필수)</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="일괄 이관 사유/비고"
          />
        </label>
      </div>
      <div className="bulk-transfer-actions">
        <button type="button" className="ghost" onClick={onSelectAll}>
          전체 선택
        </button>
        <button type="button" className="ghost" onClick={onClearSelection}>
          선택 해제
        </button>
        <button type="button" className="ghost" onClick={fillAllQuantities}>
          전체 수량 자동 입력
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
          const locationInfo = getRowLocation(item);
          const available = locationInfo ? Number(locationInfo.quantity ?? 0) : 0;
          const error = quantityErrors[item.key];
          return (
            <div key={`bulk-item-${item.key}`} className="bulk-transfer-item">
              <div className="bulk-transfer-item-main">
                <strong>{item.artist}</strong>
                <div className="muted small-text">
                  {item.album_version} / {item.option || '-'}
                </div>
                <div className="muted small-text">
                  위치: {locationInfo?.location.location ?? '복수 로케이션'} · 현재고 {available.toLocaleString()}
                </div>
              </div>
              <div className="bulk-transfer-item-input">
                <label>
                  <span>이관 수량</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={quantities[item.key] ?? ''}
                    onChange={(e) =>
                      setQuantities((prev) => ({ ...prev, [item.key]: e.target.value }))
                    }
                    placeholder="미입력=전량"
                  />
                </label>
                {error && <span className="bulk-transfer-error">{error}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="bulk-transfer-footer">
        <button
          type="button"
          className="primary"
          disabled={
            isSubmitting ||
            !canTransfer ||
            selectedItems.length === 0 ||
            !toLocation ||
            !memo.trim() ||
            hasQuantityErrors
          }
          onClick={submitBulkTransfer}
        >
          {isSubmitting ? '처리 중...' : '일괄 이관 실행'}
        </button>
        {report?.failureItems?.length ? (
          <button type="button" className="ghost" disabled={isSubmitting} onClick={retryFailures}>
            실패 항목 재시도
          </button>
        ) : null}
      </div>
      <div className="bulk-transfer-status muted small-text">
        {status || '선택 후 일괄 이관을 실행하세요.'}
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
                {report.failures.length > 4 && (
                  <li>외 {report.failures.length - 4}건</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
