import React, { useState, useRef, useEffect } from 'react'

export function Select({ value, onValueChange, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div ref={ref} className="relative inline-block w-full">
      {React.Children.map(children, c => {
        if (c.type === SelectTrigger) return React.cloneElement(c, { onClick: () => setOpen(!open) })
        if (c.type === SelectContent) return open ? React.cloneElement(c, { onSelect: (v)=>{ onValueChange?.(v); setOpen(false)} }) : null
        if (c.type === SelectValue) return React.cloneElement(c, { value })
        return c
      })}
    </div>
  )
}

export function SelectTrigger({ className='', children, onClick }) {
  return <div onClick={onClick} className={`h-10 px-3 border rounded-md flex items-center justify-between cursor-pointer bg-white ${className}`}>{children}</div>
}

export function SelectValue({ placeholder='Seleccionar', value }) {
  return <span className="text-sm">{value || placeholder}</span>
}

export function SelectContent({ children, onSelect }) {
  return (
    <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow max-h-56 overflow-auto">
      {React.Children.map(children, (c) => React.cloneElement(c, { onSelect }))}
    </div>
  )
}

export function SelectItem({ value, children, onSelect }) {
  return (
    <div
      className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
      onClick={() => onSelect?.(value)}
    >
      {children}
    </div>
  )
}
