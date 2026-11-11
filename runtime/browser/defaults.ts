import fs from 'node:fs';
import path from 'node:path';
import type { Actor, ActorPolicy } from './lab.ts';

export const DEFAULT_ACTORS: Actor[] = [
  ...Array.from({ length: 10 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return {
      id: `test-actor-${num}`,
      label: `Telegram TestDC Actor ${num} (99966${num}XXXX)`,
      network: 'test' as const
    };
  }),
  {
    id: 'prod-actor-01',
    label: 'Dedicated Production Actor 01',
    network: 'production' as const
  },
  {
    id: 'prod-actor-02',
    label: 'Dedicated Production Actor 02',
    network: 'production' as const
  }
];

export function createDefaultChatPolicy(allowedOrigins: string[] = ['http://127.0.0.1:3100', 'http://localhost:3100']): { actors: Record<string, ActorPolicy> } {
  const actors: Record<string, ActorPolicy> = {};

  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    actors[`test-actor-${num}`] = {
      network: 'test',
      allowedOrigins: [...allowedOrigins],
      chats: [
        { peerId: '101', label: 'Test Bot 101', kind: 'bot' },
        { peerId: '-202', label: 'Test Group 202', kind: 'group' }
      ]
    };
  }

  for (let i = 1; i <= 2; i++) {
    const num = String(i).padStart(2, '0');
    actors[`prod-actor-${num}`] = {
      network: 'production',
      allowedOrigins: [...allowedOrigins],
      chats: [
        { peerId: '356165930', label: 'Operator Dev Bot', kind: 'bot' }
      ]
    };
  }

  return { actors };
}

/** Pre-populates actors.json and chat-policy.json if not present in the browser root directory. */
export function initBrowserRoot(root: string, allowedOrigins?: string[]) {
  fs.mkdirSync(root, { recursive: true });

  const actorsPath = path.join(root, 'actors.json');
  if (!fs.existsSync(actorsPath)) {
    fs.writeFileSync(actorsPath, JSON.stringify(DEFAULT_ACTORS, null, 2), 'utf8');
  }

  const policyPath = path.join(root, 'chat-policy.json');
  if (!fs.existsSync(policyPath)) {
    fs.writeFileSync(policyPath, JSON.stringify(createDefaultChatPolicy(allowedOrigins), null, 2), 'utf8');
  }
}
