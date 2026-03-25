import * as lark from '@larksuiteoapi/node-sdk';
import {
  Channel,
  NewMessage,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';
import { registerChannel } from './registry.js';

interface FeishuMessageData {
  schema?: string;
  event_id?: string;
  event_type?: string;
  message?: {
    message_id?: string;
    create_time?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    sender?: {
      sender_id?: { open_id?: string; union_id?: string; user_id?: string };
      sender_type?: string;
    };
  };
}

interface FeishuConfig {
  appId: string;
  appSecret: string;
}

export class FeishuChannel implements Channel {
  name = 'feishu';
  private appId: string;
  private appSecret: string;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private registeredGroups: () => Record<string, RegisteredGroup>;
  private connected = false;
  private wsClient?: lark.WSClient;
  private client?: lark.Client;

  constructor(opts: {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => Record<string, RegisteredGroup>;
    config: FeishuConfig;
  }) {
    this.appId = opts.config.appId;
    this.appSecret = opts.config.appSecret;
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.registeredGroups = opts.registeredGroups;
  }

  async connect(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      throw new Error('Feishu credentials not configured');
    }

    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.debug,
    });

    this.wsClient.start({
      eventDispatcher: new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: FeishuMessageData) => {
          console.log('Feishu message event received');
          this.handleMessage(data);
        },
      }),
    });

    this.connected = true;
    console.log('Feishu WebSocket started');
  }

  private handleMessage(data: FeishuMessageData): void {
    const msg = data.message;
    if (!msg?.message_id || !msg?.chat_id) return;

    const chatJid = `feishu:${msg.chat_id}`;
    const senderId =
      msg.sender?.sender_id?.user_id || msg.sender?.sender_id?.open_id || '';
    const senderName = 'Feishu User';

    const content = this.extractTextContent(
      msg.message_type || '',
      msg.content || '',
    );

    const newMessage: NewMessage = {
      id: msg.message_id,
      chat_jid: chatJid,
      sender: senderId,
      sender_name: senderName,
      content,
      timestamp: msg.create_time || new Date().toISOString(),
      is_bot_message: msg.sender?.sender_type === 'bot',
    };

    console.log('Feishu message:', {
      chatJid,
      content: content.substring(0, 50),
    });

    // Store chat metadata first (before message, since message has FK to chat)
    this.onChatMetadata(
      chatJid,
      msg.create_time || '',
      senderName,
      'feishu',
      msg.chat_type === 'group',
    );
    // Then store message
    this.onMessage(chatJid, newMessage);
  }

  private extractTextContent(msgType: string, content: string): string {
    if (msgType === 'text') {
      try {
        const parsed = JSON.parse(content);
        return parsed.text || '';
      } catch {
        return content;
      }
    }
    return content;
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close?.();
      this.wsClient = undefined;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) throw new Error('Feishu not connected');

    const chatId = jid.replace('feishu:', '');
    await this.client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      params: { receive_id_type: 'chat_id' },
    });
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // Feishu doesn't support typing indicators
  }

  async syncGroups(force: boolean): Promise<void> {
    // Could sync group list from Feishu if needed
  }
}

// Self-registration
function createFeishuChannel(opts: {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}): Channel | null {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    console.warn(
      'Feishu credentials not configured (FEISHU_APP_ID, FEISHU_APP_SECRET)',
    );
    return null;
  }

  return new FeishuChannel({
    ...opts,
    config: { appId, appSecret },
  });
}

registerChannel('feishu', createFeishuChannel);
