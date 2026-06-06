/// <reference types="@testing-library/jest-dom" />

// Augment vitest's `expect` with the jest-dom matchers (toBeInTheDocument, etc.)
// so `tsc -b` typechecks the component tests the same way vitest runs them.
import 'vitest'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
