import { useEffect, useState } from 'react'

// Small workspace records persist on this device; uploaded files remain session-only.
export function useLocalState<T>(key: string, initial: T, validate?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      if (!saved) return initial
      const parsed: unknown = JSON.parse(saved)
      if (validate ? !validate(parsed) : Array.isArray(initial) && !Array.isArray(parsed)) return initial
      return parsed as T
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      window.dispatchEvent(new CustomEvent('workspace-storage-error'))
    }
  }, [key, value])
  return [value, setValue] as const
}
