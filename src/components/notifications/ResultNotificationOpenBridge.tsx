import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { onOpenResultNotification } from '@/lib/ipc'
import { openResultNotification } from '@/lib/result-notification-navigation'

function hasOpenResultNotificationApi(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electron?.onOpenResultNotification)
}

export function ResultNotificationOpenBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!hasOpenResultNotificationApi()) return

    return onOpenResultNotification((notification) => {
      void openResultNotification({
        notification,
        navigate,
        notify: (message) => toast.info(message),
      }).catch((error) => console.error(error))
    })
  }, [navigate])

  return null
}
