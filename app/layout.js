import { Viewport } from 'next';

export const viewport = {
  width: 'device-width',
  initialScale: 1.2,
  maximumScale: 3,
  userScalable: true,
};

export const metadata = { title: "Ombre Chat" };

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
