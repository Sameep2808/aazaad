import { Link, useLocation } from 'react-router-dom'
import { PlusSquare, ArrowLeft, MessageCircle } from 'lucide-react'

/**
 * Instagram-style top bar: create on the left, messages on the right.
 */
export function AppHeader({ title = 'aazaad' }: { title?: string }) {
  const location = useLocation()
  const isUpload = location.pathname === '/upload'

  return (
    <header
      className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-md"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="relative flex h-12 items-center px-2">
        {isUpload ? (
          <Link
            to="/"
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
            aria-label="Back"
          >
            <ArrowLeft className="h-6 w-6" strokeWidth={1.75} />
          </Link>
        ) : (
          <Link
            to="/upload"
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
            aria-label="Create post"
          >
            <PlusSquare className="h-6 w-6" strokeWidth={1.75} />
          </Link>
        )}

        <h1 className="pointer-events-none absolute inset-x-0 text-center text-lg font-bold tracking-wide">
          {isUpload ? 'New post' : title}
        </h1>

        {isUpload ? (
          <div className="ml-auto h-11 w-11" aria-hidden />
        ) : (
          <Link
            to="/messages"
            className="ml-auto flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
            aria-label="Messages"
          >
            <MessageCircle className="h-6 w-6" strokeWidth={1.75} />
          </Link>
        )}
      </div>
    </header>
  )
}
