import { Routes, Route, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { Home } from './pages/Home'
import { Reels } from './pages/Reels'
import { Upload } from './pages/Upload'
import { Profile } from './pages/Profile'

function App() {
  const location = useLocation()
  const isReels = location.pathname === '/reels'

  return (
    <div
      className={[
        'mx-auto flex max-w-lg flex-col bg-zinc-950',
        isReels ? 'h-[100dvh] overflow-hidden' : 'min-h-full',
      ].join(' ')}
    >
      {!isReels && (
        <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur-md">
          <h1 className="text-center text-lg font-bold tracking-wide">aazaad</h1>
        </header>
      )}

      <main
        className={[
          'flex flex-1 flex-col',
          isReels ? 'min-h-0 overflow-hidden pb-14' : 'overflow-y-auto pb-16',
        ].join(' ')}
      >
        <Routes>
          <Route path="/" element={<Home />} />
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
