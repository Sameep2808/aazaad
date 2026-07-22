import { NavLink } from 'react-router-dom'
import { Home, Clapperboard, PlusSquare, User } from 'lucide-react'

const tabs = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/reels', label: 'Reels', icon: Clapperboard, end: false },
  { to: '/upload', label: 'Upload', icon: PlusSquare, end: false },
  { to: '/profile', label: 'Profile', icon: User, end: false },
] as const

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex h-14 max-w-lg items-center justify-around px-2">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors',
                  isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300',
                ].join(' ')
              }
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
