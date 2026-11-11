import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Frame, type Page, type Locator } from 'playwright';
import { redactSecrets } from '../queue/redact.ts';

export interface Actor { id: string; label: string; network: 'test' | 'production' }
export interface SessionInfo { id: string; actorId: string; owner: string; projectId: string; network: Actor['network']; paused: boolean; mode: 'telegram' | 'fixture' }
export interface ChatTarget { peerId: string; label: string; kind: 'bot' | 'group' | 'user' }
export interface ActorPolicy { network:Actor['network'];allowedOrigins:string[];chats:ChatTarget[] }
interface Session { info: SessionInfo; context: BrowserContext; page: Page; origins: Set<string>; lock: string; errors: string[]; chats: Map<string, ChatTarget>; activePeer?: string; telegramSurface: boolean }
const publicText = (text: string) => redactSecrets(text).replace(/\S*(?:auth_date(?:=|%3[dD])|tgWebAppData(?:=|%3[dD]))\S*/g, '[REDACTED]');
const publicError = (text: string) => publicText(text).replace(/https?:\/\/[^\s"'<>]+/g,'[URL]');

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
  actorPolicy(actorId:string):ActorPolicy {
    const actor=this.actors.get(actorId);if(!actor)throw new Error('INVALID_ACTOR');
    const file=path.join(this.root,'chat-policy.json');if(!fs.existsSync(file))throw new Error('CHAT_POLICY_REQUIRED');
    let policy:ActorPolicy|undefined;
    try {policy=JSON.parse(fs.readFileSync(file,'utf8')).actors?.[actorId];}catch{throw new Error('INVALID_CHAT_POLICY');}
    if(!policy || policy.network!==actor.network || !Array.isArray(policy.allowedOrigins) || !Array.isArray(policy.chats))throw new Error('INVALID_CHAT_POLICY');
    if(policy.chats.some(c=>!c || !/^-?[1-9][0-9]{0,19}$/.test(c.peerId) || !['bot','group','user'].includes(c.kind) || !c.label) || new Set(policy.chats.map(c=>c.peerId)).size!==policy.chats.length)throw new Error('INVALID_CHAT_POLICY');
    return JSON.parse(JSON.stringify(policy)) as ActorPolicy;
  }
  async open(input: { actorId: string; owner: string; projectId: string; network: Actor['network']; allowedOrigins: string[]; fixtureUrl?: string; telegramFixture?: boolean; allowedChats?: ChatTarget[] }) {
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
    const policy=input.fixtureUrl?undefined:this.actorPolicy(actor.id);
    if(policy && [...origins].some(origin=>!policy.allowedOrigins.includes(origin)))throw new Error('APP_ORIGIN_NOT_ALLOWED');
    const requestedChats=input.allowedChats ?? policy?.chats ?? [];
    if(policy && requestedChats.some(chat=>!policy.chats.some(allowed=>allowed.peerId===chat.peerId&&allowed.kind===chat.kind)))throw new Error('CHAT_NOT_ALLOWED');
    const chats = new Map(requestedChats.map(chat => {
      if (!/^-?[1-9][0-9]{0,19}$/.test(chat.peerId) || !['bot','group','user'].includes(chat.kind) || !chat.label) throw new Error('INVALID_CHAT_TARGET');
      return [chat.peerId, { ...chat }] as const;
    }));
    const profiles = path.join(this.root, 'profiles'); fs.mkdirSync(profiles, { recursive: true });
    const profile = path.join(profiles, `${actor.network}-${actor.id}`), lock = `${profile}.lease`;
    try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, owner: input.owner }), { flag: 'wx' }); }
    catch { throw new Error('PROFILE_BUSY'); }
    let context: BrowserContext | undefined, sessionId: string | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, { headless: this.headless, viewport: { width: 1100, height: 850 } });
      const page = context.pages()[0] ?? await context.newPage();
      const info: SessionInfo = { id: randomUUID(), actorId: actor.id, owner: input.owner, projectId: input.projectId, network: actor.network, paused: false, mode: input.fixtureUrl ? 'fixture' : 'telegram' };
      const session: Session = { info, context, page, origins, lock, errors: [], chats, telegramSurface: !input.fixtureUrl || input.telegramFixture === true };
      page.setDefaultTimeout(5000);
      context.on('close', () => { this.sessions.delete(info.id); fs.rmSync(lock, { force: true }); });
      page.on('pageerror', e => { session.errors.push(publicError(e.message)); session.errors = session.errors.slice(-50); });
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
    const frames = s.page.frames().filter(f => { try { return (!s.telegramSurface || f !== s.page.mainFrame()) && s.origins.has(new URL(f.url()).origin); } catch { return false; } });
    if (frames.length !== 1) throw new Error(frames.length ? 'AMBIGUOUS_APP_FRAME' : 'NEEDS_USER_LAUNCH');
    return frames[0];
  }
  pause(id: string, owner: string) { this.session(id, owner, true).info.paused = true; }
  resume(id: string, owner: string) { this.session(id, owner, true).info.paused = false; }
  async snapshot(id: string, owner: string) {
    const s = this.session(id, owner), frame = this.app(s);
    return { text: publicText((await frame.locator('body').innerText()).slice(0, 18000)), errors: [...s.errors] };
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
  /** Explicit reconciliation only. A dead coordinator PID alone does not prove Chromium stopped. */
  recoverActorLease(actorId: string, network: Actor['network'], confirmation: 'browser-processes-confirmed-stopped') {
    if (confirmation !== 'browser-processes-confirmed-stopped') throw new Error('RECOVERY_REQUIRES_OPERATOR');
    const actor = this.actors.get(actorId);
    if (!actor || actor.network !== network) throw new Error('INVALID_ACTOR');
    const lock = path.join(this.root, 'profiles', `${network}-${actorId}.lease`);
    if (!fs.existsSync(lock)) return { recovered: false };
    let pid: number;
    try { pid = JSON.parse(fs.readFileSync(lock,'utf8')).pid; } catch { throw new Error('INVALID_LEASE_REQUIRES_OPERATOR'); }
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('INVALID_LEASE_REQUIRES_OPERATOR');
    try { process.kill(pid,0); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('PROFILE_OWNER_UNVERIFIED');
      fs.rmSync(lock); return { recovered: true };
    }
    throw new Error('PROFILE_BUSY');
  }
  private async unique(locator: Locator, code: string) {
    if (await locator.count() !== 1) throw new Error(code);
    return locator;
  }
  private async chat(s: Session) {
    if (!s.telegramSurface || !s.activePeer || !s.chats.has(s.activePeer)) throw new Error('CHAT_NOT_SELECTED');
    const root = await this.unique(s.page.locator('.chat:visible'), 'CHAT_SURFACE_UNSUPPORTED');
    const composer = await this.unique(root.locator('.input-message-input[contenteditable="true"]:visible'), 'NEEDS_HUMAN_LOGIN_OR_UNSUPPORTED_COMPOSER');
    if (await composer.getAttribute('data-peer-id') !== s.activePeer) throw new Error('UNEXPECTED_CHAT');
    const header = await this.unique(root.locator('.chat-info .peer-title[data-peer-id]:visible'), 'CHAT_IDENTITY_UNVERIFIED');
    if (await header.getAttribute('data-peer-id') !== s.activePeer) throw new Error('UNEXPECTED_CHAT');
    return { root, composer };
  }
  async openChat(id: string, owner: string, peerId: string) {
    const s = this.session(id, owner);
    if (!s.telegramSurface || !s.chats.has(peerId)) throw new Error('CHAT_NOT_ALLOWED');
    const url = new URL(s.page.url());
    if (s.info.mode === 'telegram' && (url.origin !== 'https://web.telegram.org' || url.pathname !== '/k/')) throw new Error('TELEGRAM_SURFACE_CHANGED');
    url.hash = peerId;
    await s.page.goto(url.href);
    s.activePeer = peerId;
    const root = s.page.locator('.chat:visible');
    await root.locator(`.input-message-input[data-peer-id="${peerId}"]`).waitFor({ state:'visible' });
    await this.chat(s);
    return { peerId, label:s.chats.get(peerId)!.label };
  }
  async sendText(id: string, owner: string, text: string) {
    if (!text || text.length > 4096) throw new Error('INVALID_MESSAGE');
    const s=this.session(id,owner), { composer }=await this.chat(s);
    await composer.fill(text);
    const {root}=await this.chat(this.session(id,owner));
    await (await this.unique(root.locator('.btn-send:visible'),'AMBIGUOUS_SEND_BUTTON')).click();
    return { submitted:true }; // delivery is asserted separately, never inferred from a click
  }
  async readMessages(id: string, owner: string, limit=30) {
    const s=this.session(id,owner), {root}=await this.chat(s);
    const bubbles=root.locator(`.bubble[data-peer-id="${s.activePeer}"][data-mid]:visible`);
    const count=await bubbles.count(), messages: { messageId:string; text:string }[]=[];
    for(let i=Math.max(0,count-Math.min(Math.max(limit,1),100));i<count;i++) {
      const bubble=bubbles.nth(i), message=bubble.locator('.message');
      messages.push({messageId:(await bubble.getAttribute('data-mid'))!,text:publicText((await message.allInnerTexts()).join('\n').slice(0,8000))});
    }
    return { peerId:s.activePeer!, messages };
  }
  async clickChatButton(id:string,owner:string,input:{kind:'inline'|'reply';name:string;messageId?:string}) {
    const s=this.session(id,owner),{root}=await this.chat(s);
    if(input.kind==='inline' && (!input.messageId || !/^-?\d+$/.test(input.messageId))) throw new Error('MESSAGE_ID_REQUIRED');
    const scope=input.kind==='inline' ? root.locator(`.bubble[data-peer-id="${s.activePeer}"][data-mid="${input.messageId}"] .reply-markup`) : root.locator('.reply-keyboard:visible');
    const buttons=scope.locator('.reply-markup-button, button, [role="button"]').filter({hasText:new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)});
    await (await this.unique(buttons,'AMBIGUOUS_OR_MISSING_CHAT_BUTTON')).click();
    return { clicked:true };
  }
  async stageFile(id:string,owner:string,artifactId:string) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(artifactId) || artifactId==='.' || artifactId==='..') throw new Error('INVALID_UPLOAD');
    const uploadRoot=path.resolve(this.root,'uploads'), file=path.join(uploadRoot,artifactId);
    if(!fs.existsSync(file) || path.relative(uploadRoot,fs.realpathSync(file)).startsWith('..') || !fs.statSync(file).isFile() || fs.statSync(file).size>20*1024*1024) throw new Error('INVALID_UPLOAD');
    const {root}=await this.chat(this.session(id,owner));
    await (await this.unique(root.locator('input[type="file"]'),'UPLOAD_SURFACE_UNSUPPORTED')).setInputFiles(file);
    return { staged:true, requiresSendConfirmation:true };
  }
  async launchMiniApp(id:string,owner:string,messageId:string,button:string) {
    await this.clickChatButton(id,owner,{kind:'inline',messageId,name:button});
    const s=this.session(id,owner);
    for(let i=0;i<50;i++) { try {this.app(s);return {launched:true};} catch(e) {if((e as Error).message!=='NEEDS_USER_LAUNCH') throw e;} await new Promise(r=>setTimeout(r,100)); }
    throw new Error('MINI_APP_LAUNCH_UNSUPPORTED_OR_NOT_READY');
  }
  async returnToChat(id:string,owner:string) {
    const s=this.session(id,owner); this.app(s);
    await s.page.locator('body').focus().catch(()=>{});
    await s.page.keyboard.press('Escape');
    await s.page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))).catch(()=>{});
    for(let i=0;i<30;i++) {
      try {this.app(s);} catch(e) { if((e as Error).message==='NEEDS_USER_LAUNCH') {await this.chat(s);return {returned:true};} throw e; }
      await new Promise(r=>setTimeout(r,100));
    }
    throw new Error('MINI_APP_CLOSE_REQUIRES_HUMAN');
  }
  private async widget(id:string,owner:string,messageId:string): Promise<Locator | Frame | undefined> {
    if(!/^-?\d+$/.test(messageId)) throw new Error('INVALID_MESSAGE_ID');
    const s=this.session(id,owner),{root}=await this.chat(s);
    if(s.info.network==='production' && s.chats.get(s.activePeer!)?.kind!=='bot') return undefined;
    // QuickJS runs Widget code; this only observes the client renderer (shadow DOM or iframe).
    const slot=root.locator(`.bubble.widget-message[data-peer-id="${s.activePeer}"][data-mid="${messageId}"] tweb-widget-slot:visible`);
    if(await slot.count()!==1) return undefined;
    const iframe=slot.locator('iframe:visible');
    if(await iframe.count()===0) return slot;
    if(await iframe.count()!==1) return undefined;
    const element=await iframe.elementHandle(),frame=await element?.contentFrame();
    if(!frame || frame===s.page.mainFrame()) return undefined;
    const url=frame.url();
    if(url!=='about:srcdoc' && url!=='about:blank') { try { if(!s.origins.has(new URL(url).origin)) return undefined; } catch {return undefined;} }
    return frame;
  }
  async widgetProbe(id:string,owner:string,messageId:string) {
    const frame=await this.widget(id,owner,messageId);
    return {supported:!!frame,reason:frame?'scoped_client_widget_renderer':'widget_renderer_not_available_or_not_allowed'};
  }
  async widgetAction(id:string,owner:string,messageId:string,input:{action:'snapshot'|'click';name?:string}) {
    const frame=await this.widget(id,owner,messageId);if(!frame) throw new Error('WIDGET_UNSUPPORTED');
    if(input.action==='snapshot') {
      const rawText = 'childFrames' in frame
        ? await frame.locator('body').innerText()
        : await frame.evaluate(el => el.shadowRoot ? el.shadowRoot.textContent || '' : (el as HTMLElement).innerText || '');
      return {text:publicText(rawText.slice(0,8000))};
    }
    if(!input.name) throw new Error('BUTTON_NAME_REQUIRED');
    await (await this.unique(frame.getByRole('button',{name:input.name,exact:true}),'AMBIGUOUS_WIDGET_BUTTON')).click();
    return {clicked:true};
  }
  async chatScreenshot(id:string,owner:string) {
    const {root}=await this.chat(this.session(id,owner));
    const name=`${randomUUID()}.png`,dir=path.join(this.root,'artifacts');fs.mkdirSync(dir,{recursive:true});
    await root.screenshot({path:path.join(dir,name)});return {artifactId:name,type:'screenshot'};
  }
  saveScenarioReport(report: unknown) {
    const dir=path.join(this.root,'artifacts');fs.mkdirSync(dir,{recursive:true});
    const artifactId=`${randomUUID()}.json`;
    fs.writeFileSync(path.join(dir,artifactId),publicText(JSON.stringify(report,null,2)),'utf8');
    return {artifactId,type:'scenario-report'};
  }
  async close(id: string, owner: string) {
    const s = this.session(id, owner, true);
    try { await s.context.close(); } finally { fs.rmSync(s.lock, { force: true }); this.sessions.delete(id); }
  }
  async shutdown() { for (const s of [...this.sessions.values()]) await this.close(s.info.id, s.info.owner); }
}
