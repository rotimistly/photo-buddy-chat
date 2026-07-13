// Deterministic mapping of (name, 4-digit code) → synthetic Supabase email.
// Users never see this email. It is derived on both the client (for login)
// and the server (for registration).

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "user";
}

export function deriveUserEmail(name: string, code: string): string {
  return `${slugifyName(name)}-${code}@u.local`;
}

export function isFourDigitCode(v: string): boolean {
  return /^\d{4}$/.test(v);
}

export function isValidName(v: string): boolean {
  const t = v.trim();
  return t.length >= 1 && t.length <= 40;
}
