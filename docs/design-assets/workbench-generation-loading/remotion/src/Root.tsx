import { Composition } from 'remotion'
import {
  WorkbenchGenerationLoading,
  type WorkbenchGenerationLoadingProps,
} from './WorkbenchGenerationLoading'

const defaultProps = {
  theme: 'light',
} satisfies WorkbenchGenerationLoadingProps

export function RemotionRoot() {
  return (
    <Composition
      id="WorkbenchGenerationLoading"
      component={WorkbenchGenerationLoading}
      durationInFrames={60}
      fps={30}
      width={256}
      height={256}
      defaultProps={defaultProps}
    />
  )
}
