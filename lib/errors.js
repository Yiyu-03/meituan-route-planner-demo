/** @typedef {'needs-clarification'|'insufficient-data'|'upstream-unavailable'|'bad-request'} PlanErrorCode */

export class PlanError extends Error {
  /** @param {PlanErrorCode} code @param {string} message @param {boolean} recoverable */
  constructor(code, message, recoverable) {
    super(message)
    this.name = 'PlanError'
    this.code = code
    this.recoverable = recoverable
  }

  toEvent() {
    return { type: 'error', code: this.code, message: this.message, recoverable: this.recoverable }
  }
}

export function isPlanError(value) {
  return value instanceof PlanError
}
