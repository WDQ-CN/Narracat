export type NotificationBellPlacement = 'topbar' | 'sidebar'

type NotificationDropdownPlacement = {
  align: 'center'
  side: 'bottom'
  sideOffset: number
  collisionPadding: number
}

type NotificationPanelMotion = {
  initial: {
    opacity: number
    scale: number
    x?: number
    y?: number
  }
  animate: {
    opacity: number
    scale: number
    x: number
    y: number
  }
  exit: {
    opacity: number
    scale: number
    x?: number
    y?: number
  }
  transformOrigin: string
}

const NOTIFICATION_DROPDOWN_PLACEMENT: Record<NotificationBellPlacement, NotificationDropdownPlacement> = {
  topbar: {
    align: 'center',
    side: 'bottom',
    sideOffset: 8,
    collisionPadding: 12,
  },
  sidebar: {
    align: 'center',
    side: 'bottom',
    sideOffset: 8,
    collisionPadding: 12,
  },
}

const NOTIFICATION_PANEL_MOTION: Record<NotificationBellPlacement, NotificationPanelMotion> = {
  topbar: {
    initial: { opacity: 0, scale: 0.98, y: -6 },
    animate: { opacity: 1, scale: 1, x: 0, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -4 },
    transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
  },
  sidebar: {
    initial: { opacity: 0, scale: 0.98, y: -6 },
    animate: { opacity: 1, scale: 1, x: 0, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -4 },
    transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
  },
}

export const NOTIFICATION_PANEL_TRANSITION = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.7,
} as const

export function getNotificationDropdownPlacement(
  placement: NotificationBellPlacement = 'topbar',
): NotificationDropdownPlacement {
  return NOTIFICATION_DROPDOWN_PLACEMENT[placement]
}

export function getNotificationPanelMotion(placement: NotificationBellPlacement = 'topbar'): NotificationPanelMotion {
  return NOTIFICATION_PANEL_MOTION[placement]
}
