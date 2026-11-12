const DEFAULT_BASE = '/api/worldlabs';

/**
 * Thin Marble API client.
 * Prefers the Vite proxy (/api/worldlabs) so the key stays on the server.
 * Falls back to direct API calls if you paste a key in the UI (dev only).
 */
export function createWorldLabsClient({
  baseUrl = DEFAULT_BASE,
  getApiKey = () => null,
} = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const key = getApiKey?.();
    // Only send the key on direct calls; the proxy injects WLT-Api-Key itself
    const usingProxy = baseUrl.startsWith('/api/');
    if (!usingProxy && key) {
      headers['WLT-Api-Key'] = key;
    } else if (usingProxy && key) {
      // optional override header our proxy can forward
      headers['X-WLT-Api-Key'] = key;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        JSON.stringify(data) ||
        res.statusText;
      throw new Error(`World Labs ${res.status}: ${msg}`);
    }
    return data;
  }

  async function generateFromText({ displayName, model, textPrompt }) {
    return request('/worlds:generate', {
      method: 'POST',
      body: {
        display_name: displayName,
        model,
        world_prompt: {
          type: 'text',
          text_prompt: textPrompt,
        },
      },
    });
  }

  async function getOperation(operationId) {
    return request(`/operations/${operationId}`);
  }

  async function getWorld(worldId) {
    return request(`/worlds/${worldId}`);
  }

  /**
   * Generate and poll until done (~5 min typical).
   * onProgress({ status, description, worldId, done })
   */
  async function generateAndWait(promptMeta, { onProgress, pollMs = 5000 } = {}) {
    const op = await generateFromText({
      displayName: promptMeta.displayName,
      model: promptMeta.model,
      textPrompt: promptMeta.textPrompt,
    });

    let operationId = op.operation_id;
    onProgress?.({
      status: 'STARTED',
      description: 'Generation started',
      operationId,
      done: false,
    });

    while (true) {
      const current = await getOperation(operationId);
      const progress = current.metadata?.progress;
      onProgress?.({
        status: progress?.status ?? (current.done ? 'SUCCEEDED' : 'IN_PROGRESS'),
        description: progress?.description ?? 'Waiting…',
        worldId: current.metadata?.world_id,
        operationId,
        done: !!current.done,
        error: current.error,
      });

      if (current.error) {
        throw new Error(current.error.message || JSON.stringify(current.error));
      }
      if (current.done) {
        // Prefer full world fetch; fall back to operation snapshot
        const worldId = current.metadata?.world_id || current.response?.id;
        if (worldId) {
          try {
            return await getWorld(worldId);
          } catch {
            return current.response;
          }
        }
        return current.response;
      }

      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  return {
    generateFromText,
    getOperation,
    getWorld,
    generateAndWait,
  };
}
