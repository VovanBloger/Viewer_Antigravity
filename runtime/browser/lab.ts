import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright';
import { redactSecrets } from '../queue/redact.ts';

export interface Actor { id: string; label: string; network: 'test' | 'production' }
export interface SessionInfo { id: string; actorId: string; owner: string; projectId: string; network: Actor['network']; paused: boolean; mode: 'telegram' | 'fixture' }
interface Session { info: SessionInfo; context: BrowserContext; page: Page; origins: Set<string>; lock: string; errors: string[] }

/** Browser processes are controlled through Playwright, never through the desktop mouse. */
export class BrowserLab {
  private actors = new Map<string, Actor>();
  private sessions = new Map<string, Session>();
  constructor(private root: string, private headless = false) {
    fs.mkdirSync(root, { recursive: true });
    const registry = path.join(root, 'actors.json');
    if (fs.existsSync(registry)) {
      for (const actor of JSON.parse(fs.readFileSync(registry, 'utf8')) as Actor[]) this.rememberActor(actor);
    }
  }
  private rememberActor(actor: Actor) {
    if (!/^[a-zA-Z0-9_-]+$/.test(actor.id) || !['test','production'].includes(actor.network)) throw new Error('INVALID_ACTOR');
    const existing = this.actors.get(actor.id);
    if (existing && existing.network !== actor.network) throw new Error('NETWORK_MISMATCH');
    this.actors.set(actor.id, { ...actor });
  }
  registerActor(actor: Actor) {
    this.rememberActor(actor);
    const temp = path.join(this.root, `actors-${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(this.listActors(), null, 2));
    fs.renameSync(temp, path.join(this.root, 'actors.json'));
    return { ...actor };
  }
  listActors() { return [...this.actors.values()].map(a => ({ ...a })); }
  list() { return [...this.sessions.values()].map(s => ({ ...s.info })); }
  async open(input: { actorId: string; owner: string; projectId: string; network: Actor['network']; allowedOrigins: string[]; fixtureUrl?: string }) {
    const actor = this.actors.get(input.actorId);
    if (!actor || !input.owner || !input.projectId) throw new Error('INVALID_SESSION');
    if (actor.network !== input.network) throw new Error('NETWORK_MISMATCH');
    const origins = new Set(input.allowedOrigins.map(o => {
      const u = new URL(o);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || /(^|\.)telegram\.org$/.test(u.hostname)) throw new Error('INVALID_APP_ORIGIN');
      return u.origin;
    }));
    if (input.fixtureUrl) {
      const u = new URL(input.fixtureUrl);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || !origins.has(u.origin)) throw new Error('INVALID_FIXTURE');
    }
    const profiles = path.join(this.root, 'profiles'); fs.mkdirSync(profiles, { recursive: true });
    const profile = path.join(profiles, `${actor.network}-${actor.id}`), lock = `${profile}.lease`;
    try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, owner: input.owner }), { flag: 'wx' }); }
    catch { throw new Error('PROFILE_BUSY'); }
    let context: BrowserContext | undefined, sessionId: string | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, { headless: this.headless, viewport: { width: 1100, height: 850 } });
      const page = context.pages()[0] ?? await context.newPage();
      const info: SessionInfo = { id: randomUUID(), actorId: actor.id, owner: input.owner, projectId: input.projectId, network: actor.network, paused: false, mode: input.fixtureUrl ? 'fixture' : 'telegram' };
      const session: Session = { info, context, page, origins, lock, errors: [] };
      page.on('pageerror', e => { session.errors.push(redactSecrets(e.message)); session.errors = session.errors.slice(-50); });
      this.sessions.set(info.id, session);
      sessionId = info.id;
      await page.goto(input.fixtureUrl ?? `https://web.telegram.org/k/${actor.network === 'test' ? '?test=1' : ''}`);
      return { ...info };
    } catch (e) {
      try { await context?.close(); } finally {
        if (sessionId) this.sessions.delete(sessionId);
        fs.rmSync(lock, { force: true });
      }
      throw e;
    }
  }
  private session(id: string, owner: string, allowPaused = false) {
    const s = this.sessions.get(id);
    if (!s || s.info.owner !== owner) throw new Error('SESSION_NOT_OWNED');
    if (s.info.paused && !allowPaused) throw new Error('SESSION_PAUSED');
    return s;
  }
  private app(s: Session): Frame {
    // Reacquire the live frame on every action; never cache a detached Mini App frame.
    const frames = s.page.frames().filter(f => { try { return s.origins.has(new URL(f.url()).origin); } catch { return false; } });
    if (frames.length !== 1) throw new Error(frames.length ? 'AMBIGUOUS_APP_FRAME' : 'NEEDS_USER_LAUNCH');
    return frames[0];
  }
  pause(id: string, owner: string) { this.session(id, owner, true).info.paused = true; }
  resume(id: string, owner: string) { this.session(id, owner, true).info.paused = false; }
  async snapshot(id: string, owner: string) {
    const s = this.session(id, owner), frame = this.app(s);
    return { text: redactSecrets((await frame.locator('body').innerText()).slice(0, 18000)), errors: [...s.errors] };
  }
  async click(id: string, owner: string, role: 'button' | 'link', name: string) {
    await this.app(this.session(id, owner)).getByRole(role, { name, exact: true }).click();
  }
  async fill(id: string, owner: string, label: string, value: string) {
    await this.app(this.session(id, owner)).getByLabel(label, { exact: true }).fill(value);
  }
  async screenshot(id: string, owner: string) {
    const s = this.session(id, owner), frame = this.app(s);
    const dir = path.join(this.root, 'artifacts'); fs.mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}.png`;
    await frame.locator('body').screenshot({ path: path.join(dir, name) });
    return { artifactId: name, type: 'screenshot' };
  }
  async close(id: string, owner: string) {
    const s = this.session(id, owner, true);
    try { await s.context.close(); } finally { fs.rmSync(s.lock, { force: true }); this.sessions.delete(id); }
  }
  async shutdown() { for (const s of [...this.sessions.values()]) await this.close(s.info.id, s.info.owner); }
}
