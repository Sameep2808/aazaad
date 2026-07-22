import { Routes, Route, useLocation } from 'react-router-dom'
import { AppHeader } from './components/AppHeader'
import { BottomNav } from './components/BottomNav'
import { Home } from './pages/Home'
import { Explore } from './pages/Explore'
import { Reels } from './pages/Reels'
import { Upload } from './pages/Upload'
import { Profile } from './pages/Profile'
import { UserProfile } from './pages/UserProfile'

function App() {
  const location = useLocation()
  const isReels = location.pathname === '/reels'
  const isExplore = location.pathname === '/explore'
  const isUserProfile = location.pathname.startsWith('/u/')
  /** Custom chrome: Reels/Explore/User profile handle their own top UI */
  const showAppHeader = !isReels && !isExplore && !isUserProfile

  return (
    <div
      className={[
        'mx-auto flex max-w-lg flex-col bg-zinc-950',
        'h-[100dvh] max-h-[100dvh] overflow-hidden',
      ].join(' ')}
    >
      {showAppHeader && <AppHeader />}

      <main
        className={[
          'flex min-h-0 flex-1 flex-col',
          isReels
            ? 'overflow-hidden pb-14'
            : 'scroll-touch overflow-y-auto overscroll-y-contain pb-16',
        ].join(' ')}
        style={
          isReels
            ? { paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }
            : {
                paddingBottom:
                  'calc(4rem + env(safe-area-inset-bottom))',
              }
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/u/:id" element={<UserProfile />} />
          <Route path="/reels" element={<Reels />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </main>

      <BottomNav />
    </div>
  )
}

export default App
