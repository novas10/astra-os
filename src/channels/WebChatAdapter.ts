/**
 * AstraOS — WebChatAdapter.ts
 * Embeddable web chat widget — drop-in JavaScript snippet for any website.
 * WebSocket-based real-time messaging with typing indicators and message history.
 */

import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";
import { logger } from "../utils/logger";
import { WebSocketServer, WebSocket as WS } from "ws";
import * as crypto from "crypto";

interface ChatSession {
  ws: WS;
  visitorId: string;
  startedAt: number;
  messages: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
}

export class WebChatAdapter implements ChannelAdapter {
  name = "webchat";
  private port: number;
  private title: string;
  private primaryColor: string;
  private wss?: WebSocketServer;
  private sessions: Map<string, ChatSession> = new Map();
  private handler?: (msg: IncomingMessage) => Promise<string>;

  constructor() {
    this.port = parseInt(process.env.WEBCHAT_PORT || "18790");
    this.title = process.env.WEBCHAT_TITLE || "AstraOS Chat";
    this.primaryColor = process.env.WEBCHAT_PRIMARY_COLOR || "#6366f1";
  }

  async initialize(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("connection", (ws) => {
      const visitorId = crypto.randomUUID();
      const session: ChatSession = { ws, visitorId, startedAt: Date.now(), messages: [] };
      this.sessions.set(visitorId, session);

      ws.send(JSON.stringify({ type: "connected", visitorId, title: this.title }));

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "message" && this.handler) {
            session.messages.push({ role: "user", text: msg.text, timestamp: Date.now() });

            // Send typing indicator
            ws.send(JSON.stringify({ type: "typing", isTyping: true }));

            const incoming: IncomingMessage = {
              channelType: "webchat",
              channelId: visitorId,
              userId: visitorId,
              username: msg.username || "Visitor",
              text: msg.text,
              metadata: { sessionStart: session.startedAt },
            };

            const response = await this.handler(incoming);
            session.messages.push({ role: "assistant", text: response, timestamp: Date.now() });

            ws.send(JSON.stringify({ type: "typing", isTyping: false }));
            ws.send(JSON.stringify({ type: "message", text: response, timestamp: Date.now() }));
          }

          if (msg.type === "history") {
            ws.send(JSON.stringify({
              type: "history",
              messages: session.messages.slice(-50),
            }));
          }
        } catch (err) {
          logger.error(`[WebChat] Error: ${(err as Error).message}`);
        }
      });

      ws.on("close", () => {
        this.sessions.delete(visitorId);
      });
    });

    logger.info(`[WebChatAdapter] WebSocket chat server running on port ${this.port}`);
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const session = this.sessions.get(msg.channelId);
    if (!session || session.ws.readyState !== WS.OPEN) return;

    session.ws.send(JSON.stringify({
      type: "message",
      text: msg.text,
      timestamp: Date.now(),
    }));
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.handler = handler;
  }

  getEmbedCode(hostUrl: string): string {
    return `<!-- AstraOS Chat Widget -->
<script>
(function(){
  var w=window,d=document,s=d.createElement('script');
  s.async=true;
  s.onload=function(){
    var ws=new WebSocket('ws://${hostUrl}:${this.port}');
    var container=d.createElement('div');
    container.id='astra-chat';
    container.innerHTML='<div style="position:fixed;bottom:20px;right:20px;z-index:9999;">'
      +'<div id="astra-chat-window" style="display:none;width:380px;height:520px;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.15);background:#fff;flex-direction:column;">'
      +'<div style="background:${this.primaryColor};color:#fff;padding:16px;font-weight:600;">${this.title}</div>'
      +'<div id="astra-messages" style="flex:1;overflow-y:auto;padding:12px;"></div>'
      +'<div style="padding:12px;border-top:1px solid #e5e7eb;display:flex;gap:8px;">'
      +'<input id="astra-input" placeholder="Type a message..." style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;outline:none;" />'
      +'<button id="astra-send" style="padding:8px 16px;background:${this.primaryColor};color:#fff;border:none;border-radius:8px;cursor:pointer;">Send</button>'
      +'</div></div>'
      +'<button id="astra-toggle" style="width:56px;height:56px;border-radius:50%;background:${this.primaryColor};color:#fff;border:none;cursor:pointer;font-size:24px;box-shadow:0 4px 12px rgba(0,0,0,.15);">💬</button>'
      +'</div>';
    d.body.appendChild(container);
    var toggle=d.getElementById('astra-toggle'),win=d.getElementById('astra-chat-window');
    toggle.onclick=function(){win.style.display=win.style.display==='none'?'flex':'none';};
    var input=d.getElementById('astra-input'),send=d.getElementById('astra-send'),msgs=d.getElementById('astra-messages');
    function addMsg(text,isUser){var m=d.createElement('div');m.style.cssText='margin:4px 0;padding:8px 12px;border-radius:12px;max-width:80%;'+(isUser?'background:#e5e7eb;margin-left:auto;':'background:${this.primaryColor}10;');m.textContent=text;msgs.appendChild(m);msgs.scrollTop=msgs.scrollHeight;}
    ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==='message')addMsg(m.text,false);};
    function sendMsg(){var t=input.value.trim();if(!t)return;addMsg(t,true);ws.send(JSON.stringify({type:'message',text:t}));input.value='';}
    send.onclick=sendMsg;input.onkeydown=function(e){if(e.key==='Enter')sendMsg();};
  };
  d.body.appendChild(s);
})();
</script>`;
  }

  async healthCheck(): Promise<boolean> {
    return !!this.wss && this.wss.clients.size >= 0;
  }

  getActiveSessions(): number {
    return this.sessions.size;
  }
}
