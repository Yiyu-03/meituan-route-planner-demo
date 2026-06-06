import { useCallback, useReducer, useRef } from 'react'
import type {
  SSEEvent, Constraints, ScoredPOI, Route, DataSources, PlanRequest,
} from '../../contract'
import { streamPlan, type PlanSource } from '../api/planStream'

export interface StageState {
  key: string
  label: string
  status: 'running' | 'ok' | 'skip' | 'fail'
  ms?: number
  summary?: string
}

export interface ErrorState {
  code: 'needs-clarification' | 'insufficient-data' | 'upstream-unavailable' | 'bad-request'
  message: string
  recoverable: boolean
}

export interface PlanState {
  streaming: boolean
  stages: StageState[]
  constraints: Constraints | null
  candidates: ScoredPOI[]
  route: Route | null
  explanations: Record<string, string>
  dataSources: DataSources | null
  planId: string | null
  error: ErrorState | null
}

export function initialPlanState(): PlanState {
  return {
    streaming: false,
    stages: [],
    constraints: null,
    candidates: [],
    route: null,
    explanations: {},
    dataSources: null,
    planId: null,
    error: null,
  }
}

type Action = SSEEvent | { type: 'start' } | { type: 'finish' }

export function planReducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case 'start':
      return { ...initialPlanState(), streaming: true }
    case 'finish':
      return { ...state, streaming: false }
    case 'stage': {
      const others = state.stages.filter((s) => s.key !== action.key)
      return {
        ...state,
        stages: [...others, {
          key: action.key, label: action.label, status: action.status,
          ms: action.ms, summary: action.summary,
        }],
      }
    }
    case 'constraints':
      return { ...state, constraints: action.constraints }
    case 'candidates':
      return { ...state, candidates: action.candidates }
    case 'route':
      return { ...state, route: action.route }
    case 'explanation':
      return {
        ...state,
        explanations: {
          ...state.explanations,
          [action.routeId]: (state.explanations[action.routeId] ?? '') + action.delta,
        },
      }
    case 'done':
      return {
        ...state,
        streaming: false,
        planId: action.planId,
        route: action.routes[0] ?? state.route,
        dataSources: action.dataSources,
      }
    case 'error':
      return {
        ...state,
        streaming: false,
        error: { code: action.code, message: action.message, recoverable: action.recoverable },
      }
    default:
      return state
  }
}

export interface RunOptions {
  source?: PlanSource
  fixture?: string
}

export function usePlanStream() {
  const [state, dispatch] = useReducer(planReducer, undefined, initialPlanState)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (request: PlanRequest, opts: RunOptions = {}) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'start' })
    try {
      await streamPlan(request, {
        source: opts.source,
        fixture: opts.fixture,
        signal: controller.signal,
        onEvent: (event) => dispatch(event),
      })
      dispatch({ type: 'finish' })
    } catch (err) {
      dispatch({
        type: 'error',
        code: 'upstream-unavailable',
        message: err instanceof Error ? err.message : '规划失败，请稍后重试。',
        recoverable: true,
      })
    }
  }, [])

  return { state, run }
}
