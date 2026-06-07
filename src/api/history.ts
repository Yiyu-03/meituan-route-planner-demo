import type { Route, Constraints, DataSources } from '../../contract'
import { authHeader } from './auth'

export interface HistoryListItem {
  planId: string
  request: string
  createdAt: string
}

export interface HistoryRecord {
  planId: string
  request: string
  constraints: Constraints
  routes: Route[]
  dataSources: DataSources
  createdAt: string
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { ...authHeader() } })
  if (!res.ok) throw new Error(`历史记录接口不可用 (${res.status})`)
  return (await res.json()) as T
}

export async function listHistory(): Promise<HistoryListItem[]> {
  const { plans } = await getJson<{ plans: HistoryListItem[] }>('/api/history')
  return Array.isArray(plans) ? plans : []
}

export async function getHistory(id: string): Promise<HistoryRecord> {
  const { plan } = await getJson<{ plan: HistoryRecord }>(`/api/history/${encodeURIComponent(id)}`)
  return plan
}
