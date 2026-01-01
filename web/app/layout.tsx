import './globals.css';
import React from 'react';

export const metadata = { title: 'Inventory Manager (Web)', description: 'Next.js + Supabase inventory' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
