// Administrateurs de la plateforme (page /admin, tâche 4.6) : adresses listées dans ADMIN_EMAILS,
// séparées par des virgules. Sans variable, personne. L'adresse vient des claims du JWT, vérifiées
// par Supabase (lien magique ou Google). Sans import serveur : le proxy s'en sert aussi.

export function adminEmails(raw = process.env.ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdmin(email: string | null | undefined, raw?: string): boolean {
  return Boolean(email) && adminEmails(raw).has(email!.trim().toLowerCase());
}
