'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Flame,
  Compass,
  LayoutGrid,
  Plus,
  User,
  Heart,
  Share2,
  Zap,
  Bell,
  Search,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { triggerHaptic } from '@/lib/haptics';

interface CardItem {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  likes: number;
  tag: string;
  gradient: string;
  codeSymbol: string;
}

const CARDS: CardItem[] = [
  {
    id: 'card-1',
    title: 'Кибер-Кот #01',
    subtitle: 'Неоновый стикерпак для Telegram Mini Apps',
    author: '@VovanBloger',
    likes: 128,
    tag: 'Стикеры',
    gradient: 'from-purple-600/40 via-fuchsia-600/30 to-indigo-900/40',
    codeSymbol: '01',
  },
  {
    id: 'card-2',
    title: 'Fluid Notch UI',
    subtitle: 'Адаптивная шторка навигации с плавной физикой',
    author: '@antigravity_ui',
    likes: 94,
    tag: 'Компонент',
    gradient: 'from-cyan-500/30 via-blue-600/30 to-slate-900/40',
    codeSymbol: '02',
  },
  {
    id: 'card-3',
    title: 'Haptic Pulse Pack',
    subtitle: 'Тактильный движок Web Audio + Vibration API',
    author: '@tma_studio',
    likes: 215,
    tag: 'SDK Модуль',
    gradient: 'from-emerald-500/30 via-teal-600/20 to-slate-900/40',
    codeSymbol: '03',
  },
];

export interface TgSimulatedEnv {
  colorScheme: 'dark' | 'light';
  safeAreaPad: boolean;
  mainButtonVisible: boolean;
  mainButtonText: string;
  stressOverflowBanner: boolean;
}

export function DemoApp() {
  const [activeTab, setActiveTab] = useState<'feed' | 'showcase' | 'create' | 'profile'>('feed');
  const [likedIds, setLikedIds] = useState<string[]>(['card-1']);
  const [searchText, setSearchText] = useState('');
  const [count, setCount] = useState(3);
  const [promptInput, setPromptInput] = useState('');
  const [generatedStickers, setGeneratedStickers] = useState<string[]>([
    'Неоновый маскот Antigravity v2',
    'Голографический бейдж разработчика',
  ]);
  const [tgEnv, setTgEnv] = useState<TgSimulatedEnv>({
    colorScheme: 'dark',
    safeAreaPad: true,
    mainButtonVisible: false,
    mainButtonText: 'Опубликовать в Telegram',
    stressOverflowBanner: false,
  });

  const demoRootRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    demoRootRef.current?.setAttribute('data-ag-hydrated', 'true');
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'tg:env-update' && e.data.payload) {
        setTgEnv((prev) => ({ ...prev, ...e.data.payload }));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const toggleLike = (id: string) => {
    triggerHaptic('medium', 'DemoApp:LikeButton');
    setLikedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const isLight = tgEnv.colorScheme === 'light';

  const filteredCards = CARDS.filter(
    (c) =>
      c.title.toLowerCase().includes(searchText.toLowerCase()) ||
      c.subtitle.toLowerCase().includes(searchText.toLowerCase()) ||
      c.tag.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div
      ref={demoRootRef}
      data-component="DemoApp"
      data-source-file="components/demo/DemoApp.tsx"
      data-source-line="86"
      className={`min-h-screen flex flex-col select-none font-sans overflow-x-hidden transition-colors duration-200 ${
        isLight ? 'bg-slate-50 text-slate-900' : 'bg-[#0F0E17] text-white'
      } ${tgEnv.safeAreaPad ? 'pt-14 pb-24' : 'pt-4 pb-16'}`}
    >
      {/* 1. TOP APP BAR */}
      <header
        data-component="DemoHeader"
        data-source-file="components/demo/DemoApp.tsx"
        data-source-line="97"
        className="px-4 pt-2 pb-3 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#8E2DE2] to-[#B833FF] flex items-center justify-center shadow-[0_0_20px_rgba(184,51,255,0.4)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-extrabold text-sm tracking-tight">Antigravity Studio</h1>
              <span className="text-[11px] text-[#D8B4FE] font-semibold">· PRO</span>
            </div>
            <p className={`text-[11px] font-medium ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              Интерактивное демо для теста Viewer 2.0
            </p>
          </div>
        </div>

        <button
          type="button"
          data-component="NotificationBellButton"
          data-source-file="components/demo/DemoApp.tsx"
          data-source-line="120"
          onClick={() => triggerHaptic('light', 'DemoHeader:Bell')}
          aria-label="Уведомления"
          className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
            isLight
              ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Bell className="w-4 h-4" />
        </button>
      </header>

      {/* SEARCH BAR */}
      <div
        data-component="SearchInputBar"
        data-source-file="components/demo/DemoApp.tsx"
        data-source-line="138"
        className="px-4 mb-3"
      >
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Поиск компонентов и стикеров..."
            aria-label="Поиск компонентов и стикеров"
            className={`w-full pl-9 pr-4 py-2.5 rounded-2xl border text-xs focus:outline-none focus:border-[#B833FF] transition-colors ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
                : 'bg-[#181625] border-white/10 text-white placeholder:text-zinc-500'
            }`}
          />
        </div>
      </div>

      {/* OPTIONAL STRESS-TEST OVERFLOW BANNER FOR LAYOUT LINTER */}
      {tgEnv.stressOverflowBanner && (
        <div
          data-component="StressOverflowBanner"
          data-source-file="components/demo/DemoApp.tsx"
          data-source-line="163"
          className="mx-4 mb-3 p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs flex items-center justify-between w-[460px]"
        >
          <span className="font-semibold whitespace-nowrap">
            Тестовый блок переполнения 460px (для проверки Layout Linter)
          </span>
          <button
            type="button"
            className="w-6 h-6 rounded bg-amber-500/30 text-[10px] font-bold"
            onClick={() => triggerHaptic('warning', 'StressBanner')}
          >
            !
          </button>
        </div>
      )}

      {/* 2. MAIN CONTENT */}
      <main className="px-4 space-y-4 flex-1">
        {activeTab === 'feed' && (
          <div className="space-y-4">
            {/* HERO BANNER WITH OVERLAPPING Z-INDEX LAYERS */}
            <div
              data-component="HeroBannerCard"
              data-source-file="components/demo/DemoApp.tsx"
              data-source-line="189"
              className="relative p-4 rounded-3xl bg-gradient-to-br from-[#3B1D7A] via-[#241445] to-[#131122] border border-purple-400/25 shadow-xl overflow-hidden text-white"
            >
              {/* Декоративный перекрывающий слой для теста Z-Index стека */}
              <div
                data-component="HeroGlowOverlay"
                data-source-file="components/demo/DemoApp.tsx"
                data-source-line="196"
                className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-[#B833FF]/25 blur-xl pointer-events-none"
              />

              <div className="relative z-10 space-y-2">
                <div
                  data-component="HeroTagline"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-200"
                >
                  <Flame data-component="HeroFlameIcon" className="w-3.5 h-3.5 text-amber-400" />
                  <span data-component="HeroTaglineText">Инспектор Z-Index и Тюнер 2.0</span>
                </div>
                <h2
                  data-component="HeroHeading"
                  className="text-base font-extrabold leading-snug tracking-tight"
                >
                  Нажмите Alt+I и кликните на любой элемент
                </h2>
                <p
                  data-component="HeroDescription"
                  className="text-xs text-purple-200/80 leading-relaxed"
                >
                  Проверяйте стек слоёв, меняйте прозрачность фона, ширину и скругление, и добавляйте правки в пакетную очередь для агента Antigravity.
                </p>
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    data-component="HeroActionBtn"
                    data-source-file="components/demo/DemoApp.tsx"
                    data-source-line="216"
                    onClick={() => triggerHaptic('success', 'HeroBanner:PrimaryCTA')}
                    className="px-3.5 py-2 rounded-xl bg-white text-slate-950 font-extrabold text-xs shadow-md hover:bg-purple-50 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Zap data-component="HeroActionIcon" className="w-3.5 h-3.5 text-[#8E2DE2]" />
                    <span data-component="HeroActionLabel">Тест Haptic импульса</span>
                  </button>
                  <button
                    type="button"
                    data-component="HeroShareBtn"
                    data-source-file="components/demo/DemoApp.tsx"
                    data-source-line="227"
                    onClick={() => triggerHaptic('selection', 'HeroBanner:Share')}
                    aria-label="Поделиться демо"
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/10 transition-colors cursor-pointer"
                  >
                    <Share2 data-component="HeroShareIcon" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* CARDS LIST */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span
                  data-component="SectionTitle_Modules"
                  className={`text-xs font-bold ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}
                >
                  Модули и карточки ({filteredCards.length})
                </span>
                <button
                  type="button"
                  data-component="ResetFilterBtn"
                  onClick={() => {
                    triggerHaptic('selection', 'Feed:ResetFilter');
                    setSearchText('');
                  }}
                  className="text-[11px] text-[#B833FF] font-bold cursor-pointer hover:underline"
                >
                  Сбросить фильтр
                </button>
              </div>

              {filteredCards.map((card, idx) => {
                const isLiked = likedIds.includes(card.id);
                return (
                  <div
                    key={card.id}
                    data-component={`FeatureCard_${card.id}`}
                    data-source-file="components/demo/DemoApp.tsx"
                    data-source-line={String(262 + idx * 12)}
                    className={`p-3.5 rounded-2xl border transition-all shadow-sm flex items-center justify-between gap-3 group ${
                      isLight
                        ? 'bg-white border-slate-200 hover:border-purple-400'
                        : 'bg-[#1C1A2B] border-white/10 hover:border-[#B833FF]/40'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        data-component={`CardBadge_${card.id}`}
                        className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.gradient} border border-white/10 flex items-center justify-center text-sm font-mono font-bold text-white shadow-inner shrink-0`}
                      >
                        {card.codeSymbol}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3
                            data-component={`CardTitle_${card.id}`}
                            className="text-xs font-extrabold truncate"
                          >
                            {card.title}
                          </h3>
                          <span className="text-[11px] text-slate-400">·</span>
                          <span
                            data-component={`CardTag_${card.id}`}
                            className="text-[11px] text-purple-400 font-medium whitespace-nowrap"
                          >
                            {card.tag}
                          </span>
                        </div>
                        <p
                          data-component={`CardSubtitle_${card.id}`}
                          className={`text-[11px] font-medium mt-0.5 truncate ${
                            isLight ? 'text-slate-500' : 'text-zinc-400'
                          }`}
                        >
                          {card.subtitle}
                        </p>
                        <div
                          data-component={`CardAuthor_${card.id}`}
                          className="text-[10px] text-[#B833FF] font-bold mt-1"
                        >
                          {card.author} · {isLiked ? card.likes + 1 : card.likes} лайков
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-component={`LikeBtn_${card.id}`}
                        data-source-file="components/demo/DemoApp.tsx"
                        data-source-line={String(298 + idx * 12)}
                        onClick={() => toggleLike(card.id)}
                        aria-label={`Лайк ${card.title}`}
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                          isLiked
                            ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                            : isLight
                            ? 'bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-900'
                            : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                        }`}
                      >
                        <Heart
                          data-component={`LikeIcon_${card.id}`}
                          className={`w-4 h-4 ${isLiked ? 'fill-rose-400' : ''}`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'showcase' && (
          <div
            data-component="ShowcasePanel"
            data-source-file="components/demo/DemoApp.tsx"
            data-source-line="322"
            className="space-y-4 text-center py-4"
          >
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-[#B833FF] to-[#06B6D4] flex items-center justify-center text-white font-mono text-2xl font-extrabold shadow-[0_10px_35px_rgba(184,51,255,0.4)]">
              UI
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-extrabold tracking-tight">Витрина стикеров и ассетов</h2>
              <p className={`text-xs max-w-[280px] mx-auto ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                Интерактивный компонент витрины для проверки мобильных анимаций и синхронизации кликов между экранами.
              </p>
            </div>
            <div
              className={`p-4 rounded-2xl border text-left space-y-3 ${
                isLight ? 'bg-white border-slate-200' : 'bg-[#1C1A2B] border-white/10'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold">
                <span className={isLight ? 'text-slate-500' : 'text-zinc-400'}>Активных слотов ассетов:</span>
                <span className="font-mono tabular-nums text-sm font-extrabold">{count} шт</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light', 'Showcase:Decrement');
                    setCount((c) => Math.max(1, c - 1));
                  }}
                  className={`flex-1 py-2.5 rounded-xl border text-xs font-bold cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-800 hover:bg-slate-200'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                  }`}
                >
                  − Уменьшить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light', 'Showcase:Increment');
                    setCount((c) => c + 1);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-[#B833FF] hover:bg-[#A822F0] text-white text-xs font-bold cursor-pointer shadow-md"
                >
                  + Увеличить
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'create' && (
          <div
            data-component="GeneratorStudioTab"
            data-source-file="components/demo/DemoApp.tsx"
            data-source-line="378"
            className="space-y-3"
          >
            <h2 className="text-sm font-extrabold tracking-tight">Студия генерации</h2>
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-slate-200' : 'bg-[#1C1A2B] border-white/10'
              }`}
            >
              <label htmlFor="sticker-prompt" className="text-xs font-bold text-zinc-400 block">
                Название нового ассета:
              </label>
              <input
                id="sticker-prompt"
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Кибер-маскот в неоновых очках..."
                className={`w-full px-3 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-[#B833FF] ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-900'
                    : 'bg-black/40 border-white/10 text-white'
                }`}
              />
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('success', 'Create:GenerateBtn');
                  const title = promptInput.trim() || `Стикерпак #${generatedStickers.length + 1}`;
                  setGeneratedStickers((prev) => [title, ...prev]);
                  setPromptInput('');
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#B833FF] to-[#6820DB] text-white text-xs font-bold shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Сгенерировать стикер</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {generatedStickers.map((item, i) => (
                <div
                  key={i}
                  className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between ${
                    isLight ? 'bg-white border-slate-200' : 'bg-[#181625] border-white/5'
                  }`}
                >
                  <span className="font-medium truncate">{item}</span>
                  <span className="text-[11px] font-mono text-emerald-400">Готово</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div
            data-component="DeveloperProfileCard"
            data-source-file="components/demo/DemoApp.tsx"
            data-source-line="438"
            className="space-y-3"
          >
            <div
              className={`p-4 rounded-3xl border flex items-center gap-4 ${
                isLight ? 'bg-white border-slate-200' : 'bg-[#1C1A2B] border-white/10'
              }`}
            >
              <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#B833FF] to-[#EC4899] flex items-center justify-center text-white text-lg font-extrabold shadow-lg">
                V
              </div>
              <div>
                <h3 className="text-sm font-extrabold">Владимир</h3>
                <p className="text-xs text-zinc-400 font-medium">@VovanBloger</p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-400 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Автор Viewer_Antigravity</span>
                </div>
              </div>
            </div>

            <div
              className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                isLight ? 'bg-white border-slate-200' : 'bg-[#181625] border-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Тема Telegram WebApp:</span>
                <span className="font-mono font-bold">{tgEnv.colorScheme}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Safe Area защита:</span>
                <span className="font-mono font-bold">{tgEnv.safeAreaPad ? 'Активна' : 'Отключена'}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* TELEGRAM MAIN BUTTON SIMULATION */}
      {tgEnv.mainButtonVisible && (
        <div className="fixed bottom-16 inset-x-0 px-4 py-2 z-30">
          <button
            type="button"
            data-component="TelegramMainButton"
            data-source-file="components/demo/DemoApp.tsx"
            data-source-line="486"
            onClick={() => triggerHaptic('heavy', 'Telegram:MainButton')}
            className="w-full py-3 rounded-xl bg-[#B833FF] hover:bg-[#a224e6] text-white text-xs font-extrabold shadow-lg cursor-pointer transition-transform active:scale-98"
          >
            {tgEnv.mainButtonText}
          </button>
        </div>
      )}

      {/* 3. BOTTOM TAB NAVIGATION */}
      <nav
        data-component="BottomTabNav"
        data-source-file="components/demo/DemoApp.tsx"
        data-source-line="500"
        aria-label="Нижняя навигация Mini App"
        className={`fixed bottom-0 inset-x-0 h-16 backdrop-blur-xl border-t px-4 flex items-center justify-around z-30 ${
          isLight ? 'bg-white/95 border-slate-200' : 'bg-[#151421]/95 border-white/10'
        }`}
      >
        {[
          { id: 'feed', label: 'Лента', icon: Compass },
          { id: 'showcase', label: 'Витрина', icon: LayoutGrid },
          { id: 'create', label: 'Создать', icon: Plus },
          { id: 'profile', label: 'Профиль', icon: User },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                triggerHaptic('selection', `BottomNav:${tab.id}`);
                setActiveTab(tab.id as 'feed' | 'showcase' | 'create' | 'profile');
              }}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-3 rounded-xl transition-all cursor-pointer min-w-[56px] min-h-[44px] ${
                isActive
                  ? 'text-[#B833FF] font-extrabold'
                  : isLight
                  ? 'text-slate-500 hover:text-slate-900 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 font-medium'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
