import { useCallback, useState, type ReactNode } from 'react'
import { Heart } from 'lucide-react'
import { useDoubleTap } from '../hooks/useDoubleTap'

interface DoubleTapLikeLayerProps {
  /** Called on double tap — should like (not unlike) */
  onLike: () => void
  /** Optional single tap (e.g. play/pause video) */
  onSingleTap?: () => void
  className?: string
  children: ReactNode
}

/**
 * Full-bleed media wrapper: double-tap likes with heart burst; scroll stays smooth.
 */
export function DoubleTapLikeLayer({
  onLike,
  onSingleTap,
  className = '',
  children,
}: DoubleTapLikeLayerProps) {
  const [burstKey, setBurstKey] = useState(0)

  const handleDouble = useCallback(() => {
    setBurstKey((k) => k + 1)
    onLike()
  }, [onLike])

  const handlers = useDoubleTap(handleDouble, onSingleTap)

  return (
    <div
      className={['relative touch-manipulation select-none', className].join(
        ' ',
      )}
      {...handlers}
    >
      {children}
      {burstKey > 0 && (
        <div
          key={burstKey}
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          aria-hidden
        >
          <Heart className="heart-burst h-24 w-24 fill-white text-white drop-shadow-lg" />
        </div>
      )}
    </div>
  )
}
