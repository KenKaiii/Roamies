// A named combo can work even while 9router's full model list is waiting on an unrelated provider.
// Validate the combo on Connect; routine refreshes only check the dashboard, never bill another chat.
export async function probeNineRouter(endpoint, { timeoutMs = 30000, signal, verify = false, fetchImpl = fetch } = {}) {
  const root = endpoint.baseUrl.replace(/\/+$/, '');
  const modelId = endpoint.modelId || 'my-combo';
  const headers = verify && endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {};
  try {
    const response = await fetchImpl(verify ? `${root}/chat/completions` : `${root.replace(/\/v1$/, '')}/dashboard`, {
      headers: { ...headers, ...(verify ? { 'Content-Type': 'application/json' } : {}) },
      ...(verify ? { method: 'POST', body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false }) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return { endpoint, reachable: false, models: [], reason: [401, 403].includes(response.status) ? 'rejected the API key' : `9router returned HTTP ${response.status}` };
    if (verify) {
      const body = await response.json();
      if (!body.choices?.some((c) => typeof c.message?.content === 'string' || c.message?.tool_calls?.length)) return { endpoint, reachable: false, models: [], reason: '9router returned no chat reply' };
    } else { await response.body?.cancel(); }
    return { endpoint, reachable: true, models: [{ rawId: modelId, endpointId: endpoint.id,
      contextWindow: 32768, contextWindowKnown: false, supportsTools: true,
      supportsImages: endpoint.supportsImages === true, supportsThinking: false }] };
  } catch {
    return { endpoint, reachable: false, models: [], reason: '9router connection timed out or failed' };
  }
}
