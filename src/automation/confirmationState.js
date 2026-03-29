export function createConfirmationStateMachine() {
  let pendingRequest = null;

  return {
    set(request) {
      pendingRequest = {
        ...request,
        requestedAt: Date.now(),
      };
      return pendingRequest;
    },
    get() {
      return pendingRequest;
    },
    clear() {
      const previousRequest = pendingRequest;
      pendingRequest = null;
      return previousRequest;
    },
    hasPending() {
      return Boolean(pendingRequest);
    },
  };
}

