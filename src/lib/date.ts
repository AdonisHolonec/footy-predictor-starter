export function formatRO(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}
