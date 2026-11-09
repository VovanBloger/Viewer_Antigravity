import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Viewer Antigravity — Multi-Device Preview & Visual Inspector Studio',
  description: 'Next-Gen Multi-Device Responsive Preview & Live Visual Inspection Studio for Telegram Mini Apps & Web Apps',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body className="antialiased min-h-screen bg-[#090810] text-zinc-100 overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
