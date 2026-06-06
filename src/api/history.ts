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

export function listHistory(): Promise<HistoryListItem[]> {
  return getJson<HistoryListItem[]>('/api/history')
}

export function getHistory(id: string): Promise<HistoryRecord> {
  return getJson<HistoryRecord>(`/api/history/${encodeURIComponent(id)}`)
}
