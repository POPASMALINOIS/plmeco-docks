import React, { createContext, useEffect, useMemo, useState } from 'react'
import { doc, provider, awareness } from './collabClient'

export const CollabContext = createContext(null)

export default function CollabProvider({ children }) {
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    const handleStatus = ({ status }) => setStatus(status)
    provider.on('status', handleStatus)
    return () => {
      provider.off('status', handleStatus)
    }
  }, [])

  const value = useMemo(() => ({ doc, provider, awareness, status }), [status])
  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>
}
