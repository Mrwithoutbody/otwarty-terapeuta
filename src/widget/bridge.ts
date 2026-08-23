/**
 * MCP Apps bridge.
 *
 * The widget talks to its host over the standard `ui/*` JSON-RPC bridge on
 * `postMessage`, and uses the `window.openai` conveniences when running inside
 * ChatGPT. Everything the bridge delivers is treated as UNTRUSTED data: it is
 * rendered as text, never as HTML, and never used to build a URL without
 * validation.
 */

export interface HostMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

type Listener = (payload: unknown) => void;

interface OpenAiGlobal {
  toolInput?: unknown;
  toolOutput?: unknown;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

declare global {
  interface Window {
    openai?: OpenAiGlobal;
  }
}

class McpAppBridge {
  private readonly resultListeners = new Set<Listener>();
  private readonly pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private latestToolResult: unknown = null;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('message', this.onMessage);
    // ChatGPT delivers the payload on `window.openai`, not over the `ui/*` bridge,
    // and it may not be populated yet when this module is evaluated. It announces
    // every later assignment with an `openai:set_globals` event - without listening
    // for it the widget sits on "Wczytuję dane…" forever inside ChatGPT.
    window.addEventListener('openai:set_globals', this.onGlobals);
    const initial = window.openai?.toolOutput;
    if (initial !== undefined && initial !== null) this.latestToolResult = initial;
    // ChatGPT does not reliably emit `openai:set_globals`, and the iframe can mount
    // either before or after the payload lands - which is why the widget rendered
    // fine on one turn and sat on "Wczytuję dane…" on the next. Poll until the data
    // shows up rather than giving up after a few seconds.
    else this.pollForOutput();
    // Tell the host the surface is ready to receive notifications.
    this.notify('ui/initialize', {});
  }

  private pollForOutput(): void {
    let attempts = 0;
    // ponytail: polling, because no delivery path is guaranteed in every host.
    // 250 ms x 480 = 2 minutes, well past any render; drop this once one push
    // channel proves reliable across ChatGPT and the Inspector.
    const timer = setInterval(() => {
      attempts += 1;
      const output = window.openai?.toolOutput;
      if (output !== undefined && output !== null) {
        clearInterval(timer);
        this.onGlobals();
      } else if (attempts >= 480) {
        clearInterval(timer);
      }
    }, 250);
  }

  private readonly onGlobals = (): void => {
    const output = window.openai?.toolOutput;
    if (output === undefined || output === null || output === this.latestToolResult) return;
    this.latestToolResult = output;
    for (const listener of this.resultListeners) listener(output);
  };

  private readonly onMessage = (event: MessageEvent): void => {
    const data = event.data as HostMessage | undefined;
    if (!data || data.jsonrpc !== '2.0') return;

    if (data.id !== undefined && (data.result !== undefined || data.error !== undefined)) {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error.message));
      else entry.resolve(data.result);
      return;
    }

    switch (data.method) {
      case 'ui/notifications/tool-result':
      case 'ui/notifications/tool-input': {
        const params = data.params as { result?: unknown; structuredContent?: unknown } | undefined;
        const payload = params?.structuredContent ?? params?.result ?? params;
        if (data.method === 'ui/notifications/tool-result') {
          this.latestToolResult = payload;
          for (const listener of this.resultListeners) listener(payload);
        }
        break;
      }
      default:
        break;
    }
  };

  private post(message: HostMessage): void {
    if (typeof window === 'undefined' || !window.parent) return;
    window.parent.postMessage(message, '*');
  }

  private notify(method: string, params: unknown): void {
    this.post({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Host nie odpowiedział na żądanie.'));
      }, 20_000);
    });
  }

  getToolResult(): unknown {
    return this.latestToolResult ?? window.openai?.toolOutput ?? null;
  }

  onToolResult(listener: Listener): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  /**
   * Calls a tool on the server. Write operations still require server-side
   * authorisation and an explicit confirmation - this call is never the
   * security boundary.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (window.openai?.callTool) return window.openai.callTool(name, args);
    return this.request('tools/call', { name, arguments: args });
  }

}

export const bridge = typeof window === 'undefined' ? null : new McpAppBridge();
