import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { BrandLoading } from '@/components/brand/BrandLoading'
import { LoadRecoveryNotice } from '@/components/LoadRecoveryNotice'
import {
  listNovelProjects,
  readWorkLocation,
  rememberNovelProjectPath,
  writeWorkLocation,
} from '@/lib/ipc'
import { createLoadIssue, type LoadIssue } from '@/lib/load-state'
import { resolveStartupWorkLocation } from '@/lib/work-location-startup'

type StartupState =
  | { status: 'loading'; issue: null }
  | { status: 'ready'; issue: null }
  | { status: 'error'; issue: LoadIssue }

export function WorkLocationStartupGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const startedRef = useRef(false)
  const [state, setState] = useState<StartupState>({ status: 'loading', issue: null })

  const restore = useCallback(async () => {
    setState({ status: 'loading', issue: null })

    try {
      const resolution = await resolveStartupWorkLocation({
        listProjects: listNovelProjects,
        pathname: location.pathname,
        readLocation: readWorkLocation,
        rememberProjectPath: rememberNovelProjectPath,
        writeLocation: writeWorkLocation,
      })
      if (resolution.kind === 'navigate') {
        navigate(resolution.href, { replace: true })
      } else if (resolution.kind === 'fallback-library') {
        toast.warning(resolution.message)
      }
      setState({ status: 'ready', issue: null })
    } catch (error) {
      setState({ status: 'error', issue: createLoadIssue('startup', error) })
    }
  }, [location.pathname, navigate])

  useEffect(() => {
    if (location.pathname !== '/' && state.status !== 'ready') {
      setState({ status: 'ready', issue: null })
      return
    }
    if (startedRef.current) return
    startedRef.current = true
    void restore()
  }, [location.pathname, restore, state.status])

  if (state.status === 'ready') return children
  if (state.status === 'loading') return <BrandLoading />

  return (
    <main className="flex h-full min-h-0 items-center justify-center bg-canvas p-6">
      <LoadRecoveryNotice
        className="w-full max-w-md"
        from="/"
        issue={state.issue}
        onRetry={() => void restore()}
      />
    </main>
  )
}
