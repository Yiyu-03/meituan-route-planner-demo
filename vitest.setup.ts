import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Node 25 ships an experimental global `localStorage` that lacks `.clear()` and
// shadows jsdom's Storage. Install a spec-compliant in-memory Storage so the
// session client (and its tests) behave like a real browser.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

const memoryStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: memoryStorage,
})
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  })
}

afterEach(() => {
  cleanup()
})
