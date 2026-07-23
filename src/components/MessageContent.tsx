import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LINK_RE = /(\/p\/[0-9a-f]{64}|\/u\/(?:npub1[a-z0-9]+|[0-9a-f]{64}))/gi

/**
 * Render DM text with in-app /p/ and /u/ links clickable.
 */
export function MessageContent({ content }: { content: string }) {
  const nodes: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  const re = new RegExp(LINK_RE.source, 'gi')

  while ((match = re.exec(content)) !== null) {
    if (match.index > last) {
      nodes.push(content.slice(last, match.index))
    }
    const path = match[0]
    nodes.push(
      <Link
        key={`link-${key++}`}
        to={path}
        className="underline underline-offset-2 opacity-95"
      >
        {path}
      </Link>,
    )
    last = match.index + path.length
  }

  if (last < content.length) {
    nodes.push(content.slice(last))
  }

  return <>{nodes.length > 0 ? nodes : content}</>
}
