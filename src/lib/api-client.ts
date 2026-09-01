type RequestOptions = RequestInit & {
    params?: Record<string, string>;
    timeout?: number; // 超时时间（毫秒），默认 60000
};

export class ApiError extends Error {
    constructor(public status: number, public statusText: string, public data: unknown) {
        super(`API Error: ${status} ${statusText}`);
        this.name = 'ApiError';
    }
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers, timeout = 60000, signal: callerSignal, ...rest } = options;

    let finalUrl = url;
    if (params) {
        const searchParams = new URLSearchParams(params);
        finalUrl += `?${searchParams.toString()}`;
    }

    const defaultHeaders: HeadersInit = {
        'Content-Type': 'application/json',
    };

    // 创建 AbortController 用于超时控制
    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

    try {
        const res = await fetch(finalUrl, {
            headers: {
                ...defaultHeaders,
                ...headers,
            },
            ...rest,
            signal,
        });

        if (res.status === 204) return {} as T;

        const raw = await res.text();
        let data: unknown = {};
        if (raw) {
            try {
                data = JSON.parse(raw);
            } catch {
                data = raw;
            }
        }

        if (!res.ok) throw new ApiError(res.status, res.statusText, data);
        return data as T;
    } catch (error) {
        if (timeoutSignal.aborted) {
            throw new ApiError(408, 'Request Timeout', {
                message: 'AI_TIMEOUT_ERROR'
            });
        }
        throw error;
    }
}

export const apiClient = {
    get: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'GET' }),
    post: <TResponse, TBody = unknown>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <TResponse, TBody = unknown>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    patch: <TResponse, TBody = unknown>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
};
