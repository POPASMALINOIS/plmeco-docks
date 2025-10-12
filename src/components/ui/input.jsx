import React from 'react'
export function Input({ className='', ...props }) {
  return <input className={`w-full h-10 px-3 rounded-md border border-gray-300 focus:outline-none focus:ring ${className}`} {...props}/>
}
