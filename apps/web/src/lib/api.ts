export async function fetchHealth() {
  const response = await fetch('/health');
  return response.json() as Promise<{ status: string; name: string }>;
}
