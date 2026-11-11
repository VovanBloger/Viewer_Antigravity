import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Viewer Antigravity 2.0 Workbench',
  description:
    'Инженерная станция мультиэкранного предпросмотра, Z-Index инспекции DOM и пакетной интеграции с ИИ-агентом Antigravity для Telegram Mini Apps и мобильных веб-приложений.',
  openGraph: {
    title: 'Viewer Antigravity 2.0 Workbench',
    description:
      'Инженерная станция мультиэкранного предпросмотра, Z-Index инспекции DOM и пакетной интеграции с ИИ-агентом Antigravity для Telegram Mini Apps и мобильных веб-приложений.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Viewer Antigravity 2.0 Workbench',
    description:
      'Инженерная станция мультиэкранного предпросмотра, Z-Index инспекции DOM и пакетной интеграции с ИИ-агентом Antigravity для Telegram Mini Apps и мобильных веб-приложений.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className="dark"
      suppressHydrationWarning
    >
      <body className="font-sans antialiased selection:bg-[#B833FF]/30 selection:text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
