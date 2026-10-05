/** Sign-up and password rules shared by the screens and the server actions. Pure. */
export const MIN_PASSWORD = 8;

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** A message when the password breaks a rule, else null. */
export function passwordProblem(password: string): string | null {
  return password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : null;
}
