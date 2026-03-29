function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

export function buildLaptopMockResult(action) {
  return {
    ok: true,
    status: 'mocked',
    message: `[MOCK LAPTOP] ${action.summary}`,
    data: {
      operation: action.target.operation,
      mock: true,
    },
  };
}

export async function executeLaptopAction(action, {
  useMock = true,
  endpoint = '/api/automation/execute',
}) {
  if (useMock) {
    await wait(350);
    return buildLaptopMockResult(action);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || `Laptop automation returned HTTP ${response.status}.`);
  }

  return payload;
}

