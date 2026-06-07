export { PlanError, isPlanError } from './errors.js'
export type PlanErrorCode =
  | 'needs-clarification' | 'insufficient-data' | 'upstream-unavailable' | 'bad-request'
