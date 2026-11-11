import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';

export type PilotMethod = 'sendMessage'|'answerCallbackQuery'|'sendWidget'|'answerWidgetQuery'|'editMessageWidgetData';
export interface BotTransport { call(method: PilotMethod, payload: Record<string,unknown>): Promise<{ok:boolean;result?:unknown}> }
export interface PilotMessage { message_id:number; chat:{id:number;type:'private'|'group'|'supergroup'};from:{id:number};text?:string }
export interface PilotUpdate {
  update_id:number;
  message?:PilotMessage;
  callback_query?:{id:string;from:{id:number};message?:PilotMessage;data?:string};
  widget_query?:{id:string;from:{id:number};chat?:PilotMessage['chat'];message_id?:number;type:{type:string};data:string};
}
export const COUNTER_WIDGET_HTML = `<html><body><p id="count">0</p><button id="add">+1</button><script>
function draw(){document.getElementById('count').textContent=JSON.parse(TelegramWidget.chatData||'{"count":0}').count}
TelegramWidget.onEvent('chatDataChanged',draw);draw();
document.getElementById('add').addEventListener('click',function(){TelegramWidget.request('inc')});
</script></body></html>`;

/** A deterministic independent pilot. Network transport must be injected; no token/polling implementation exists here. */
export class CounterPilot {
  private db:DatabaseSync;
  private appUrl?:string;
  private sending=false;
  readonly network:'test'|'production';
  private chats:Set<number>;
  private users:Set<number>;
  constructor(databasePath:string, private transport:BotTransport, options:{network:'test'|'production';allowedChatIds:number[];allowedUserIds:number[];miniAppUrl?:string}) {
    if(!['test','production'].includes(options.network) || !options.allowedChatIds.length || !options.allowedUserIds.length || [...options.allowedChatIds,...options.allowedUserIds].some(id=>!Number.isSafeInteger(id)||id===0)) throw new Error('EXPLICIT_PILOT_SCOPE_REQUIRED');
    this.network=options.network;this.chats=new Set(options.allowedChatIds);this.users=new Set(options.allowedUserIds);
    if(options.miniAppUrl) this.setMiniAppUrl(options.miniAppUrl);
    if(databasePath!==':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)),{recursive:true});
    this.db=new DatabaseSync(databasePath);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS pilot_updates(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS pilot_counts(chat INTEGER PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pilot_payments(chat INTEGER NOT NULL, order_id TEXT NOT NULL, PRIMARY KEY(chat,order_id));
      CREATE TABLE IF NOT EXISTS pilot_outbox(id INTEGER PRIMARY KEY, method TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS pilot_widgets(chat INTEGER NOT NULL, message_id INTEGER NOT NULL, PRIMARY KEY(chat,message_id));`);
  }
  setMiniAppUrl(value:string) {
    const url=new URL(value);
    if(url.username || url.password || (url.protocol!=='https:' && !(this.network==='test' && url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error('INVALID_MINI_APP_URL');
    this.appUrl=url.href;
  }
  private scope(chat:number,user?:number) { if(!this.chats.has(chat)||(user!==undefined&&!this.users.has(user))) throw new Error('PILOT_SCOPE_DENIED'); }
  count(chat:number) { this.scope(chat);return Number(this.db.prepare('SELECT value FROM pilot_counts WHERE chat=?').get(chat)?.value ?? 0); }
  private increment(chat:number) {
    this.db.prepare('INSERT INTO pilot_counts VALUES(?,1) ON CONFLICT(chat) DO UPDATE SET value=value+1').run(chat);
    return this.count(chat);
  }
  private enqueue(method:PilotMethod,payload:Record<string,unknown>) { this.db.prepare('INSERT INTO pilot_outbox(method,payload) VALUES(?,?)').run(method,JSON.stringify(payload)); }
  private once(key:string, action:()=>void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted=this.db.prepare('INSERT OR IGNORE INTO pilot_updates VALUES(?)').run(key).changes===1;
      if(inserted) action();
      this.db.exec('COMMIT');return !inserted;
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  incrementFixture(chat:number,requestId:string) {
    this.scope(chat);
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new Error('REQUEST_ID_REQUIRED');
    const duplicate=this.once(`http:${chat}:${requestId}`,()=>{this.increment(chat)});
    return {count:this.count(chat),duplicate,mode:'fixture' as const};
  }
  async receive(update:PilotUpdate) {
    if(!Number.isSafeInteger(update.update_id)||update.update_id<0) throw new Error('INVALID_UPDATE_ID');
    if([update.message,update.callback_query,update.widget_query].filter(Boolean).length!==1) throw new Error('UNSUPPORTED_UPDATE');
    const message=update.message, callback=update.callback_query, widget=update.widget_query;
    const chat=message?.chat ?? callback?.message?.chat ?? widget?.chat;
    const user=message?.from.id ?? callback?.from.id ?? widget?.from.id;
    if(!chat || user===undefined) throw new Error('PILOT_CHAT_CONTEXT_REQUIRED');
    this.scope(chat.id,user);
    const duplicate=this.once(`telegram:${update.update_id}`,()=>{
      if(message) this.command(message);
      else if(callback) {
        const valid=callback.data==='inc';
        const count=valid?this.increment(chat.id):this.count(chat.id);
        this.enqueue('answerCallbackQuery',{callback_query_id:callback.id,text:valid?`Count: ${count}`:'Unsupported action'});
        if(valid) this.enqueue('sendMessage',{chat_id:chat.id,text:`Count: ${count}`});
      }else if(widget) {
        if(widget.type.type!=='data' || !widget.message_id || !this.db.prepare('SELECT 1 FROM pilot_widgets WHERE chat=? AND message_id=?').get(chat.id,widget.message_id)) throw new Error('UNKNOWN_PILOT_WIDGET');
        if(!['inc','count'].includes(widget.data)) throw new Error('UNSUPPORTED_WIDGET_QUERY');
        if(widget.data==='inc') this.increment(chat.id);
        const data=JSON.stringify({count:this.count(chat.id)});
        this.enqueue('answerWidgetQuery',{widget_query_id:widget.id,data});
        this.enqueue('editMessageWidgetData',{chat_id:chat.id,message_id:widget.message_id,chat_data:data});
      }
    });
    await this.flush();return {duplicate,count:this.count(chat.id)};
  }
  private command(message:PilotMessage) {
    const {chat}=message, text=(message.text ?? '').trim();
    const send=(body:string,extra:Record<string,unknown>={})=>this.enqueue('sendMessage',{chat_id:chat.id,text:body,...extra});
    if(text==='/start') {
      send('Counter pilot. /inc /count /widget /pay_test <order>. Payments are simulated.',{reply_markup:{keyboard:[[{text:'+1'},{text:'/count'}]],resize_keyboard:true}});
      if(chat.type==='private'&&this.appUrl) send('Open counter Mini App',{reply_markup:{inline_keyboard:[[{text:'Open Mini App',web_app:{url:this.appUrl}}],[{text:'+1',callback_data:'inc'}]]}});
      else send('Counter controls',{reply_markup:{inline_keyboard:[[{text:'+1',callback_data:'inc'}]]}});
    }else if(text==='/inc'||text==='+1') send(`Count: ${this.increment(chat.id)}`);
    else if(text==='/count') send(`Count: ${this.count(chat.id)}`);
    else if(text==='/widget') {
      if(this.network==='production'&&chat.type!=='private'){send('Group Widgets require the Telegram test server.');return}
      if(Buffer.byteLength(COUNTER_WIDGET_HTML)>32768||deflateSync(COUNTER_WIDGET_HTML,{level:9}).length>4096) throw new Error('WIDGET_TOO_LARGE');
      this.enqueue('sendWidget',{chat_id:chat.id,html:COUNTER_WIDGET_HTML,allow_queries:true,chat_data:JSON.stringify({count:this.count(chat.id)}),height:100,caption:'Counter pilot Widget'});
    }else if(text.startsWith('/pay_test')) {
      const order=text.split(/\s+/)[1];
      if(!order||!/^[a-zA-Z0-9_-]{1,64}$/.test(order)){send('Usage: /pay_test <order> — simulation only');return}
      const fresh=this.db.prepare('INSERT OR IGNORE INTO pilot_payments VALUES(?,?)').run(chat.id,order).changes===1;
      send(JSON.stringify({mode:'simulated',order,fulfilled:fresh,alreadyFulfilled:!fresh,realPayment:false}));
    }else send('Counter pilot: /start /inc /count /widget /pay_test <order>');
  }
  async flush() {
    if(this.sending) return;
    this.sending=true;
    try {
      for(const row of this.db.prepare("SELECT * FROM pilot_outbox WHERE state='pending' ORDER BY id").all()) {
        const claim=this.db.prepare("UPDATE pilot_outbox SET state='sending' WHERE id=? AND state='pending'").run(row.id);
        if(claim.changes!==1) continue;
        let response:{ok:boolean;result?:unknown};
        try { response=await this.transport.call(String(row.method) as PilotMethod,JSON.parse(String(row.payload))); }
        catch { this.db.prepare("UPDATE pilot_outbox SET state='pending' WHERE id=?").run(row.id);throw new Error('PILOT_TRANSPORT_FAILED') }
        if(!response.ok){this.db.prepare("UPDATE pilot_outbox SET state='pending' WHERE id=?").run(row.id);throw new Error('PILOT_TRANSPORT_FAILED')}
        this.db.exec('BEGIN IMMEDIATE');
        try {
          if(row.method==='sendWidget') {
            const payload=JSON.parse(String(row.payload)), result=response.result as {message_id?:number}|undefined;
            if(!Number.isSafeInteger(result?.message_id)) throw new Error('INVALID_WIDGET_SEND_RESULT');
            this.db.prepare('INSERT OR IGNORE INTO pilot_widgets VALUES(?,?)').run(payload.chat_id,result!.message_id!);
          }
          this.db.prepare("UPDATE pilot_outbox SET state='sent' WHERE id=?").run(row.id);this.db.exec('COMMIT');
        }catch(e){this.db.exec('ROLLBACK');throw e}
      }
    }finally{this.sending=false}
  }
  deliveryStatus() { return this.db.prepare('SELECT state,COUNT(*) AS count FROM pilot_outbox GROUP BY state').all().map(r=>({state:String(r.state),count:Number(r.count)})); }
  close() { if(this.sending) throw new Error('DELIVERY_IN_PROGRESS');this.db.close(); }
}
