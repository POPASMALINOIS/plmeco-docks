import React, { useState } from 'react'
export function Select({ value, onValueChange, children }) {
  return <div data-select>{React.Children.map(children, c => React.cloneElement(c, { value, onValueChange }))}</div>
}
export function SelectTrigger({ className='', children }) { return <div className={className}>{children}</div> }
export function SelectValue({ placeholder }) { return <span>{placeholder || ''}</span> }
export function SelectContent({ children }) { return <div className="border rounded-md bg-white shadow p-1 inline-block">{children}</div> }
export function SelectItem({ value, children, onValueChange }) {
  return <div className="px-2 py-1 hover:bg-gray-100 cursor-pointer rounded" onClick={()=>onValueChange?.(value)}>{children}</div>
}
