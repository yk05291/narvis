// 화면용 아주 작은 캐시: 같은 주소에서 받은 데이터를 기억해 뒀다가
// Focus 카드처럼 같은 패널을 한 번 더 그릴 때 '빈 화면' 없이 바로 보여줘요. (그 뒤 최신 데이터로 교체)
const cache = new Map<string, unknown>();

export function cachedJson<T>(url: string): T | undefined {
  return cache.get(url) as T | undefined;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T;
  if (res.ok && !(data as { error?: unknown })?.error) cache.set(url, data);
  return data;
}
