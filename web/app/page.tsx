'use client';
import React, { useEffect, useState } from 'react';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string>('로그인 필요');
  const [stock, setStock] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [movement, setMovement] = useState({
    artist: '',
    category: 'album',
    album_version: '',
    option: '',
    location: '',
    quantity: 0,
    direction: 'IN',
    idempotencyKey: ''
  });

  async function login() {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      setStatus('로그인 완료');
      await refresh();
    } else {
      setStatus('로그인 실패');
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setStatus('로그아웃됨');
  }

  async function refresh() {
    const stockRes = await fetch('/api/inventory');
    if (stockRes.ok) setStock(await stockRes.json());
    const histRes = await fetch('/api/history');
    if (histRes.ok) setHistory(await histRes.json());
  }

  async function submitMovement() {
    const body = { ...movement, quantity: Number(movement.quantity) };
    const res = await fetch('/api/movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setStatus(res.ok ? '기록 완료' : '기록 실패');
    await refresh();
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main>
      <Section title="로그인">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={login}>로그인</button>
          <button onClick={logout}>로그아웃</button>
          <span>{status}</span>
        </div>
      </Section>

      <Section title="입/출고 등록">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem' }}>
          <input placeholder="아티스트" value={movement.artist} onChange={(e) => setMovement({ ...movement, artist: e.target.value })} />
          <input placeholder="카테고리(album/md)" value={movement.category} onChange={(e) => setMovement({ ...movement, category: e.target.value })} />
          <input placeholder="앨범/버전" value={movement.album_version} onChange={(e) => setMovement({ ...movement, album_version: e.target.value })} />
          <input placeholder="옵션" value={movement.option} onChange={(e) => setMovement({ ...movement, option: e.target.value })} />
          <input placeholder="로케이션" value={movement.location} onChange={(e) => setMovement({ ...movement, location: e.target.value })} />
          <input type="number" placeholder="수량" value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: Number(e.target.value) })} />
          <select value={movement.direction} onChange={(e) => setMovement({ ...movement, direction: e.target.value })}>
            <option value="IN">입고</option>
            <option value="OUT">출고</option>
            <option value="ADJUST">조정</option>
          </select>
          <input placeholder="idempotency key" value={movement.idempotencyKey} onChange={(e) => setMovement({ ...movement, idempotencyKey: e.target.value })} />
          <button onClick={submitMovement}>등록</button>
        </div>
      </Section>

      <Section title="현재 재고">
        <table className="table">
          <thead>
            <tr>
              <th>아티스트</th><th>카테고리</th><th>앨범/버전</th><th>옵션</th><th>로케이션</th><th>현재고</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((row) => (
              <tr key={`${row.artist}-${row.album_version}-${row.option}-${row.location}`}>
                <td>{row.artist}</td>
                <td>{row.category}</td>
                <td>{row.album_version}</td>
                <td>{row.option}</td>
                <td>{row.location}</td>
                <td>{row.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="입출고 이력">
        <table className="table">
          <thead>
            <tr>
              <th>일시</th><th>유형</th><th>아티스트</th><th>카테고리</th><th>앨범/버전</th><th>옵션</th><th>로케이션</th><th>수량</th><th>담당</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, idx) => (
              <tr key={idx}>
                <td>{h.created_at}</td>
                <td>{h.direction}</td>
                <td>{h.artist}</td>
                <td>{h.category}</td>
                <td>{h.album_version}</td>
                <td>{h.option}</td>
                <td>{h.location}</td>
                <td>{h.quantity}</td>
                <td>{h.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}
