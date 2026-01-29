import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const API_BASE_RAW = process.env.EXPO_PUBLIC_API_BASE ?? '';

const normalizeApiBase = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace('https://https://', 'https://').replace(/\/+$/, '');
};

const API_BASE = normalizeApiBase(API_BASE_RAW);

type InventoryRow = {
  item_id?: string | null;
  artist: string;
  category: string;
  album_version: string;
  location: string;
  quantity: number;
  barcode?: string | null;
};

type Props = {
  accessToken: string;
  initialQuery?: string;
};

export default function InventoryScreen({ accessToken, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [status, setStatus] = useState('');

  const fetchInventory = async () => {
    if (!API_BASE) {
      setStatus('API base가 필요합니다.');
      return;
    }
    setStatus('조회 중...');
    try {
      const url = `${API_BASE}/api/mobile/inventory?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus(payload?.error || '조회 실패');
        return;
      }
      setRows(payload ?? []);
      setStatus(`조회 결과 ${payload?.length ?? 0}건`);
    } catch (error: any) {
      setStatus(error?.message || '조회 실패');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>재고 조회</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flexInput]}
            value={query}
            onChangeText={setQuery}
            placeholder="아티스트/버전/바코드"
          />
          <TouchableOpacity style={styles.button} onPress={fetchInventory}>
            <Text style={styles.buttonText}>조회</Text>
          </TouchableOpacity>
        </View>
        {status ? <Text style={styles.status}>{status}</Text> : null}
        {rows.map((row, idx) => (
          <View key={`${row.item_id ?? idx}-${row.location}`} style={styles.card}>
            <Text style={styles.cardTitle}>
              {row.artist} · {row.album_version}
            </Text>
            <Text style={styles.cardSub}>
              {row.location} / 수량 {row.quantity}
            </Text>
            {row.barcode ? <Text style={styles.cardSub}>Barcode: {row.barcode}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  flexInput: {
    flex: 1,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  status: {
    color: '#6b7280',
  },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#f9fafb',
  },
  cardTitle: {
    fontWeight: '600',
    fontSize: 14,
  },
  cardSub: {
    color: '#4b5563',
    marginTop: 4,
  },
});
