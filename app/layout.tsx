import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'cyrillic-ext'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
});

const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

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
      className={`dark ${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased selection:bg-[#B833FF]/30 selection:text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
