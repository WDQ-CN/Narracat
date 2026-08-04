import {
  getAgentThreadSnapshot,
  getNovelProject,
  listNovelProjects,
  markResultNotificationRead,
} from '@/lib/ipc'
import { useAgentStore } from '@/lib/agent-store'
import { buildWorkbenchTargetHref } from '@/lib/workbench-selection'
import { getAgentThreadIdForProjectIdentity } from '@shared/types/agent'
import type { ResultNotification, ResultNotificationList } from '@shared/types/notifications'

type Navigate = (href: string) => void

export async function resolveResultNotificationHref(notification: ResultNotification): Promise<{
  href: string
  message?: string
}> {
  if (notification.href) return { href: notification.href }

  try {
    const projectPath =
      notification.projectPath ??
      (
        await listNovelProjects()
      ).find((project) => getAgentThreadIdForProjectIdentity(project) === notification.threadId)?.path
    if (!projectPath) return { href: '/' }

    const project = await getNovelProject(projectPath)
    if (!notification.target) {
      const params = new URLSearchParams({ project: projectPath })
      return { href: `/workbench?${params.toString()}` }
    }

    return {
      href: buildWorkbenchTargetHref({
        project,
        projectPath,
        target: notification.target,
      }),
    }
  } catch {
    return {
      href: '/',
      message: '项目路径已失效，已返回图书馆。',
    }
  }
}

export async function openResultNotification({
  navigate,
  notification,
  notify,
}: {
  navigate: Navigate
  notification: ResultNotification
  notify?: (message: string) => void
}): Promise<ResultNotificationList | null> {
  const payload = notification.readAt ? null : await markResultNotificationRead(notification.id)
  if (
    notification.segmentId &&
    useAgentStore.getState().segmentIdByThreadId[notification.threadId] !== notification.segmentId
  ) {
    const history = await getAgentThreadSnapshot(
      notification.threadId,
      notification.segmentId,
    ).catch(() => null)
    if (history) useAgentStore.getState().prependHistorySnapshot(history)
  }
  const destination = await resolveResultNotificationHref(notification)

  if (notification.questionRequestId) {
    useAgentStore.getState().focusQuestionRequest(notification.questionRequestId, notification.threadId)
  }

  navigate(destination.href)
  if (destination.message) notify?.(destination.message)
  return payload
}
