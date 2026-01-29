import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const API_BASE_RAW = process.env.EXPO_PUBLIC_API_BASE ?? '';

const normalizeApiBase = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const fixed = trimmed.replace('https://https://', 'https://').replace(/\/+$/, '');
  return fixed;
};

const API_BASE = normalizeApiBase(API_BASE_RAW);

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

type InventoryRow = {
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
  barcode?: string | null;
};

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([]);
  const [inventoryStatus, setInventoryStatus] = useState('');
  const [scanMode, setScanMode] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [movementPayload, setMovementPayload] = useState({
    artist: '',
    category: 'album',
    album_version: '',
    option: '',
    location: '',
    quantity: '',
    direction: 'IN',
    memo: '',
    barcode: '',
  });
  const [transferPayload, setTransferPayload] = useState({
    artist: '',
    category: 'album',
    album_version: '',
    option: '',
    from_location: '',
    to_location: '',
    quantity: '',
    memo: '',
    barcode: '',
  });

  const canScan = useMemo(() => permission?.granted ?? false, [permission]);

  const authHeader = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const fetchInventory = async (queryValue: string) => {
    if (!API_BASE) {
      Alert.alert('API base missing', 'EXPO_PUBLIC_API_BASE 환경 변수를 설정하세요.');
      return;
    }
    setInventoryStatus('재고 조회 중...');
    try {
      const url = `${API_BASE}/api/mobile/inventory?q=${encodeURIComponent(queryValue)}`;
      const res = await fetch(url, { headers: { ...authHeader } });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.ok !== true) {
        const message = payload?.error || payload?.message || '재고 조회 실패';
        setInventoryStatus(message);
        return;
      }
      setInventoryRows(payload.rows ?? []);
      setInventoryStatus(`조회 결과 ${payload.rows?.length ?? 0}건`);
    } catch (error: any) {
      setInventoryStatus(error?.message || '재고 조회 중 오류');
    }
  };

  const handleLogin = async () => {
    setLoginError('');
    if (!email || !password) {
      setLoginError('이메일/비밀번호를 입력하세요.');
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setLoginError('Supabase 환경 변수를 설정하세요.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data?.session?.access_token) {
        setLoginError(error?.message || '로그인 실패');
        setLoading(false);
        return;
      }
      setToken(data.session.access_token);
      setLoading(false);
    } catch (error: any) {
      setLoginError(error?.message || '로그인 실패');
      setLoading(false);
    }
  };

  const handleScan = ({ data }: { data: string }) => {
    if (!data) return;
    setScanMode(false);
    setInventoryQuery(data);
    fetchInventory(data);
  };

  const submitMovement = async () => {
    if (!API_BASE) return;
    const payload = {
      ...movementPayload,
      quantity: Number(movementPayload.quantity),
    };
    try {
      const res = await fetch(`${API_BASE}/api/mobile/movements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok !== true) {
        Alert.alert('입출고 실패', data?.error || '요청 실패');
        return;
      }
      Alert.alert('입출고 완료', '등록되었습니다.');
    } catch (error: any) {
      Alert.alert('입출고 실패', error?.message || '요청 실패');
    }
  };

  const submitTransfer = async () => {
    if (!API_BASE) return;
    const payload = {
      ...transferPayload,
      quantity: Number(transferPayload.quantity),
    };
    try {
      const res = await fetch(`${API_BASE}/api/mobile/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok !== true) {
        Alert.alert('이관 실패', data?.error || '요청 실패');
        return;
      }
      Alert.alert('이관 완료', '전산 이관이 완료되었습니다.');
    } catch (error: any) {
      Alert.alert('이관 실패', error?.message || '요청 실패');
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>Inventory Mobile</Text>
          <TextInput
            style={styles.input}
            placeholder="이메일"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="비밀번호"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
          <Button title={loading ? '로그인 중...' : '로그인'} onPress={handleLogin} disabled={loading} />
          <Text style={styles.helperText}>API Base: {API_BASE || '미설정'}</Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>재고 조회</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flexInput]}
            placeholder="검색어 또는 바코드"
            value={inventoryQuery}
            onChangeText={setInventoryQuery}
          />
          <Button title="조회" onPress={() => fetchInventory(inventoryQuery)} />
        </View>
        <View style={styles.row}>
          <TouchableOpacity style={styles.scanButton} onPress={() => setScanMode(true)}>
            <Text style={styles.scanButtonText}>스캔</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.helperText}>{inventoryStatus}</Text>
        {inventoryRows.map((row, idx) => (
          <View key={`${row.artist}-${row.album_version}-${row.option}-${idx}`} style={styles.card}>
            <Text style={styles.cardTitle}>{row.artist} · {row.album_version} · {row.option || '-'}</Text>
            <Text style={styles.cardSub}>
              {row.location} / 수량 {row.quantity}
            </Text>
            {row.barcode ? <Text style={styles.cardSub}>Barcode: {row.barcode}</Text> : null}
          </View>
        ))}

        <Text style={styles.sectionTitle}>입출고 등록</Text>
        <TextInput style={styles.input} placeholder="artist" value={movementPayload.artist} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, artist: text }))} />
        <TextInput style={styles.input} placeholder="category" value={movementPayload.category} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, category: text }))} />
        <TextInput style={styles.input} placeholder="album_version" value={movementPayload.album_version} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, album_version: text }))} />
        <TextInput style={styles.input} placeholder="option" value={movementPayload.option} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, option: text }))} />
        <TextInput style={styles.input} placeholder="location" value={movementPayload.location} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, location: text }))} />
        <TextInput style={styles.input} placeholder="quantity" keyboardType="numeric" value={movementPayload.quantity} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, quantity: text }))} />
        <TextInput style={styles.input} placeholder="direction (IN/OUT/ADJUST)" value={movementPayload.direction} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, direction: text }))} />
        <TextInput style={styles.input} placeholder="memo" value={movementPayload.memo} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, memo: text }))} />
        <TextInput style={styles.input} placeholder="barcode" value={movementPayload.barcode} onChangeText={(text) => setMovementPayload((prev) => ({ ...prev, barcode: text }))} />
        <Button title="입출고 등록" onPress={submitMovement} />

        <Text style={styles.sectionTitle}>전산 이관</Text>
        <TextInput style={styles.input} placeholder="artist" value={transferPayload.artist} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, artist: text }))} />
        <TextInput style={styles.input} placeholder="category" value={transferPayload.category} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, category: text }))} />
        <TextInput style={styles.input} placeholder="album_version" value={transferPayload.album_version} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, album_version: text }))} />
        <TextInput style={styles.input} placeholder="option" value={transferPayload.option} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, option: text }))} />
        <TextInput style={styles.input} placeholder="from_location" value={transferPayload.from_location} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, from_location: text }))} />
        <TextInput style={styles.input} placeholder="to_location" value={transferPayload.to_location} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, to_location: text }))} />
        <TextInput style={styles.input} placeholder="quantity" keyboardType="numeric" value={transferPayload.quantity} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, quantity: text }))} />
        <TextInput style={styles.input} placeholder="memo" value={transferPayload.memo} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, memo: text }))} />
        <TextInput style={styles.input} placeholder="barcode" value={transferPayload.barcode} onChangeText={(text) => setTransferPayload((prev) => ({ ...prev, barcode: text }))} />
        <Button title="전산 이관" onPress={submitTransfer} />
      </ScrollView>

      {scanMode && (
        <View style={styles.scanOverlay}>
          {!canScan ? (
            <View style={styles.scanPrompt}>
              <Text style={styles.cardTitle}>카메라 권한이 필요합니다.</Text>
              <Button title="권한 요청" onPress={() => requestPermission()} />
              <Button title="닫기" onPress={() => setScanMode(false)} />
            </View>
          ) : (
            <CameraView
              style={StyleSheet.absoluteFill}
              onBarcodeScanned={handleScan}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39'] }}
            />
          )}
          <View style={styles.scanControls}>
            <Button title="닫기" onPress={() => setScanMode(false)} />
          </View>
        </View>
      )}
      <StatusBar style="dark" />
      <Text style={styles.buildInfo}>Build: {Constants.expoConfig?.version ?? 'dev'}</Text>
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
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
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  scanButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  scanButtonText: {
    color: '#fff',
    fontWeight: '600',
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
  helperText: {
    color: '#6b7280',
  },
  errorText: {
    color: '#b91c1c',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanPrompt: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  scanControls: {
    position: 'absolute',
    bottom: 40,
  },
  buildInfo: {
    position: 'absolute',
    bottom: 6,
    right: 12,
    fontSize: 10,
    color: '#9ca3af',
  },
});
