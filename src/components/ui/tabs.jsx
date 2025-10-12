import React, { useState, createContext, useContext } from 'react'
const TabsCtx = createContext()
export function Tabs({ value, onValueChange, children }) {
  const [val, setVal] = useState(value)
  const set = (v) => { setVal(v); onValueChange?.(v) }
  return <TabsCtx.Provider value={{val, set}}>{children}</TabsCtx.Provider>
}
export function TabsList({ className='', ...p }) { return <div className={`flex gap-2 ${className}`} {...p}/> }
export function TabsTrigger({ value, className='', children }) {
  const { val, set } = useContext(TabsCtx)
  const active = val === value
  return (
    <button onClick={()=>set(value)}
      className={`px-2 py-1 rounded-md text-sm border ${active ? 'bg-black text-white' : 'bg-white text-gray-900' } ${className}`}>
      {children}
    </button>
  )
}
export function TabsContent({ value, className='', children }) {
  const { val } = useContext(TabsCtx)
  if (val !== value) return null
  return <div className={className}>{children}</div>
}
