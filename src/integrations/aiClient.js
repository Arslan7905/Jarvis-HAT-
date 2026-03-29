function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

export async function sendAiPrompt(aiEndpoint, prompt, attempt = 1) {
  const trimmedAiEndpoint = aiEndpoint.trim();

  if (!trimmedAiEndpoint) {
    throw new Error('AI backend endpoint is not configured.');
  }

  try {
    const response = await fetch(trimmedAiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('AI backend returned invalid JSON.');
    }

    if (!response.ok) {
      throw new Error(payload?.error || `AI backend returned HTTP ${response.status}.`);
    }

    if (typeof payload?.text !== 'string' || !payload.text.trim()) {
      throw new Error('AI backend returned an empty reply.');
    }

    return payload.text.trim();
  } catch (error) {
    if (attempt === 1) {
      await wait(900);
      return sendAiPrompt(aiEndpoint, prompt, 2);
    }

    throw error;
  }
}

