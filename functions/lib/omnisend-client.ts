const OMNISEND_API_BASE = 'https://api.omnisend.com/v3';

export interface OmnisendSettings {
  api_key?: string;
  store_url?: string;
  enabled?: boolean;
  use_display_locale?: boolean;
}

export class OmnisendClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    let url = `${OMNISEND_API_BASE}${path}`;
    if (params) {
      url += '?' + new URLSearchParams(params).toString();
    }

    const res = await fetch(url, {
      method,
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Omnisend ${method} ${path} failed ${res.status}: ${text}`);
    }

    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  get<T = any>(path: string, params?: Record<string, string>) {
    return this.request<T>('GET', path, undefined, params);
  }

  post<T = any>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }

  put<T = any>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }

  patch<T = any>(path: string, body: unknown, params?: Record<string, string>) {
    return this.request<T>('PATCH', path, body, params);
  }

  delete<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

export function getSettings(rawSettings: any): OmnisendSettings {
  return (rawSettings?.omnisend ?? {}) as OmnisendSettings;
}
