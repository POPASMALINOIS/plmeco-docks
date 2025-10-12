import React from 'react'
export function Button({ children, className='', variant='default', size='md', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-2xl px-3 py-2 text-sm font-medium shadow'
  const variants = {
    default: 'bg-black text-white hover:opacity-90',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
    outline: 'border border-gray-300 text-gray-900 hover:bg-gray-50',
    destructive: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-gray-800 hover:bg-gray-100'
  }
  const sizes = { sm: 'h-8', md: 'h-10', icon: 'h-8 w-8 p-0' }
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>{children}</button>
}
