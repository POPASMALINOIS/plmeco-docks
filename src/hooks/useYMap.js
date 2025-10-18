import { useContext, useEffect, useMemo, useState } from 'react'
import { CollabContext } from '@/collab/CollabProvider'

// Hook para vincular un Y.Map con estado React
export default function useYMap(name) {
  const { doc } = useContext(CollabContext)
  const ymap = useMemo(() => doc.getMap(name), [doc, name])

  const snapshot = () => Object.fromEntries(ymap.entries())
  const [data, setData] = useState(snapshot)

  useEffect(() => {
    const update = () => setData(snapshot())
    ymap.observeDeep(update)
    return () => ymap.unobserveDeep(update)
  }, [ymap])

  const set = (key, value) => ymap.set(key, value)
  const del = (key) => ymap.delete(key)

  return [data, { set, delete: del, ymap }]
}
