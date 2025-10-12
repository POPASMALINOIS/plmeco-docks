import React from 'react'
export function Sheet({ open, onOpenChange, children }) { return <>{children}</> }
export function SheetContent({ side='right', className='', children }) {
  return (
    <div className={`fixed top-0 ${side==='right'?'right-0':'left-0'} h-full w-[420px] bg-white shadow-2xl p-4 overflow-auto ${className}`}>
      {children}
    </div>
  )
}
export function SheetHeader({ children }) { return <div className="mb-2">{children}</div> }
export function SheetTitle({ children }) { return <div className="text-lg font-semibold">{children}</div> }
