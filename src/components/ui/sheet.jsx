import React from 'react'

const SheetContext = React.createContext({ open: false, onOpenChange: () => {} })

export function Sheet({ open, onOpenChange, children }) {
  return <SheetContext.Provider value={{ open, onOpenChange }}>{children}</SheetContext.Provider>
}

export function SheetContent({ side='right', className='', children }) {
  const { open, onOpenChange } = React.useContext(SheetContext)
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed top-0 ${side==='right'?'right-0':'left-0'} h-full w-[420px] sm:w-[480px] bg-white shadow-2xl p-4 overflow-auto ${className}`}
    >
      <button
        aria-label="Cerrar"
        onClick={() => onOpenChange?.(false)}
        className="absolute top-2 right-2 text-sm px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
      >✕</button>
      {children}
    </div>
  )
}

export function SheetHeader({ children }) { return <div className="mb-2">{children}</div> }
export function SheetTitle({ children })  { return <div className="text-lg font-semibold">{children}</div> }
