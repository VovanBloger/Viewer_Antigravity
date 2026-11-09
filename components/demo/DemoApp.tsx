'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  Heart,
  Share2,
  Plus,
  Compass,
  LayoutGrid,
  User,
  Star,
  Zap,
  CheckCircle2,
  Flame,
  ArrowRight
} from 'lucide-react';
import { triggerHaptic } from '@/lib/haptics';

export function DemoApp() {
  const [activeTab, setActiveTab] = useState<'feed' | 'showcase' | 'create' | 'profile'>('feed');
  const [likedIds, setLikedIds] = useState<number[]>([1, 3]);
  const [stars, setStars] = useState(250);
  const [count, setCount] = useState(1);

  const toggleLike = (id: number) => {
    triggerHaptic('light');
    setLikedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const CARDS = [
    {
      id: 1,
      title: 'Neon Cyber Cat 3D',
      subtitle: 'Анимированный стикер • 512×512',
      tag: '🔥 Тренды',
      author: '@cybersamurai',
      likes: 1420,
      gradient: 'from-purple-600/30 to-indigo-900/40',
      emoji: '🐱⚡',
    },
    {
      id: 2,
      title: 'Holographic Void Orb',
      subtitle: 'Telegram Custom Emoji Pack',
      tag: '✨ Новинка',
      author: '@antigravity_dev',
      likes: 890,
      gradient: 'from-cyan-600/30 to-blue-900/40',
      emoji: '🔮💫',
    },
    {
      id: 3,
      title: 'Quantum Glitch Kitty',
      subtitle: 'Dynamic Video Sticker (WebM)',
      tag: '🚀 Топ недели',
      author: '@vovanbloger',
      likes: 3120,
      gradient: 'from-fuchsia-600/30 to-pink-900/40',
      emoji: '🐾🌌',
    },
  ];

  return (
    <div className="min-h-screen bg-[#111019] text-zinc-100 flex flex-col justify-between select-none font-sans pb-24">
      {/* 1. HEADER */}
      <header className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-white/5 bg-[#171622]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#B833FF] to-[#06B6D4] flex items-center justify-center text-white text-xs font-black shadow-md">
            VK
          </div>
          <div>
            <div className="text-xs font-black flex items-center gap-1.5">
              <span>Viewer Mini App</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#B833FF] animate-pulse" />
            </div>
            <div className="text-[10px] text-zinc-400">@antigravity_preview</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              triggerHaptic('selection');
              setStars(s => s + 50);
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-amber-300 transition-all cursor-pointer shadow-xs active:scale-95"
          >
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>{stars}</span>
          </button>
        </div>
      </header>

      {/* 2. BODY CONTENT BASED ON ACTIVE TAB */}
      <main className="flex-1 p-4 space-y-4">
        {activeTab === 'feed' && (
          <div className="space-y-4">
            {/* Promo banner */}
            <div className="p-4 rounded-3xl bg-gradient-to-br from-[#B833FF]/25 via-[#6820DB]/20 to-transparent border border-[#B833FF]/40 relative overflow-hidden shadow-lg">
              <div className="relative z-10 space-y-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#B833FF] text-white text-[10px] font-black uppercase tracking-wider">
                  <Flame className="w-3 h-3" />
                  Live Demo Studio
                </span>
                <h2 className="text-base font-black tracking-tight leading-snug">
                  Тестируйте адаптивность в реальном времени
                </h2>
                <p className="text-xs text-zinc-300 font-medium leading-relaxed">
                  Нажимайте на любые элементы инспектором для замера отступов, классов Tailwind и мгновенного редактирования.
                </p>
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('medium');
                      setActiveTab('showcase');
                    }}
                    className="px-4 py-2 rounded-xl bg-white text-zinc-950 text-xs font-extrabold flex items-center gap-1.5 hover:bg-zinc-100 transition-all cursor-pointer shadow-md active:scale-95"
                  >
                    <span>Открыть витрину</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Feed Cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black uppercase tracking-wider text-zinc-400">
                  Популярные карточки
                </span>
                <span className="text-[11px] text-[#B833FF] font-bold cursor-pointer">
                  Смотреть все ({CARDS.length})
                </span>
              </div>

              {CARDS.map(card => {
                const isLiked = likedIds.includes(card.id);
                return (
                  <div
                    key={card.id}
                    className="p-3.5 rounded-2xl bg-[#1C1A2B] border border-white/5 hover:border-[#B833FF]/40 transition-all shadow-md flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${card.gradient} border border-white/10 flex items-center justify-center text-2xl shadow-inner shrink-0 group-hover:scale-105 transition-transform`}>
                        {card.emoji}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-black truncate">{card.title}</h3>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/5 text-zinc-400 font-bold">
                            {card.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 font-medium mt-0.5 truncate">
                          {card.subtitle}
                        </p>
                        <div className="text-[10px] text-[#D8B4FE] font-bold mt-1">
                          {card.author}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleLike(card.id)}
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                          isLiked
                            ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                            : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                        }`}
                        title="Лайк"
                      >
                        <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-400' : ''}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'showcase' && (
          <div className="space-y-4 text-center py-4">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-tr from-[#B833FF] to-[#06B6D4] flex items-center justify-center text-5xl shadow-[0_10px_35px_rgba(184,51,255,0.4)]">
              🚀
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black tracking-tight">Витрина стикеров и ассетов</h2>
              <p className="text-xs text-zinc-400 max-w-[280px] mx-auto">
                Интерактивный компонент витрины для проверки мобильных анимаций и переходов.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[#1C1A2B] border border-white/5 text-left space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-zinc-400">Счётчик ассетов:</span>
                <span className="text-white font-mono">{count} шт</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setCount(c => Math.max(1, c - 1));
                  }}
                  className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-black cursor-pointer"
                >
                  - Уменьшить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setCount(c => c + 1);
                  }}
                  className="flex-1 py-2 rounded-xl bg-[#B833FF] hover:bg-[#A822F0] text-white text-xs font-black cursor-pointer shadow-md"
                >
                  + Увеличить
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'create' && (
          <div className="space-y-3">
            <h2 className="text-sm font-black tracking-tight">Студия генерации</h2>
            <div className="p-4 rounded-2xl bg-[#1C1A2B] border border-white/5 space-y-3">
              <label className="text-xs font-bold text-zinc-400 block">Промпт для генерации:</label>
              <input
                type="text"
                placeholder="Милый кот в неоновых очках..."
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#B833FF]"
              />
              <button
                type="button"
                onClick={() => triggerHaptic('success')}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#B833FF] to-[#6820DB] text-white text-xs font-black uppercase tracking-wider shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Сгенерировать стикер</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div className="p-4 rounded-3xl bg-[#1C1A2B] border border-white/5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#B833FF] to-[#EC4899] flex items-center justify-center text-white text-lg font-black shadow-lg">
                V
              </div>
              <div>
                <h3 className="text-sm font-black">Владимир</h3>
                <p className="text-xs text-zinc-400 font-medium">@VovanBloger</p>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Верифицированный разработчик</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 3. BOTTOM TAB NAVIGATION */}
      <nav className="fixed bottom-0 inset-x-0 h-16 bg-[#151421]/95 backdrop-blur-xl border-t border-white/10 px-6 flex items-center justify-around z-30">
        {[
          { id: 'feed', label: 'Лента', icon: Compass },
          { id: 'showcase', label: 'Витрина', icon: LayoutGrid },
          { id: 'create', label: 'Создать', icon: Plus },
          { id: 'profile', label: 'Профиль', icon: User },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setActiveTab(tab.id as any);
              }}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'text-[#B833FF] scale-105 font-black'
                  : 'text-zinc-400 hover:text-zinc-200 font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-2'}`} />
              <span className="text-[10px]">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
