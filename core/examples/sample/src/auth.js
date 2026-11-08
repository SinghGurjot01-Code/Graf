/** Validates a user session. */
export function validateSession(session) {
  return Boolean(session && session.userId);
}

/** Handles an incoming login request. */
export async function handleLogin(request) {
  const session = request.session;
  return validateSession(session);
}
