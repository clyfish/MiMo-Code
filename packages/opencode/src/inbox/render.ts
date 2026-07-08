import type { InboxRow } from "./inbox.sql"

export function renderInboxRow(row: InboxRow): string {
  if (row.type === "actor_notification") {
    // Pre-rendered notification text — sender produced the full
    // <actor-notification>...</actor-notification> wrapper.
    const content = row.content as { text?: string }
    return content.text ?? "(no notification body)"
  }
  // Default: type === "text" or unknown — wrap as <inbox> element so
  // the LLM can route by sender; the wrapper format mirrors the
  // <actor-notification> convention from the legacy completion.ts.
  const content = row.content as { text?: string }
  const sender = row.sender_session_id
    ? `${row.sender_session_id}:${row.sender_actor_id ?? "?"}`
    : "system"
  const sentAt = new Date(row.created_at).toISOString()
  return `<inbox from="${sender}" sent_at="${sentAt}">\n${content.text ?? "(empty)"}\n</inbox>`
}

export function renderActorNotification(event: {
  actorID: string
  description: string
  status: "completed" | "failed" | "cancelled" | "stalled"
  result?: string
  error?: string
  reportedStatus?: string
  reportedSummary?: string
  // For a stalled notification: how long (ms) since the child's last turn advanced.
  stalledForMs?: number
}): string {
  const header = `Background actor "${event.description}" (actor_id: ${event.actorID})`
  if (event.status === "completed") {
    const statusLine = `Status: ${event.reportedStatus ?? "unknown"}`
    const summaryLine = event.reportedSummary ? `\nSummary: ${event.reportedSummary}` : ""
    return `<actor-notification>\n${header} completed.\n${statusLine}${summaryLine}\nResult: ${event.result ?? "(no output)"}\n</actor-notification>`
  }
  if (event.status === "failed") {
    return `<actor-notification>\n${header} failed.\nError: ${event.error ?? "unknown"}\n</actor-notification>`
  }
  if (event.status === "stalled") {
    const forLine =
      event.stalledForMs !== undefined ? ` (no turn advance for ${Math.floor(event.stalledForMs / 1000)}s)` : ""
    return `<actor-notification>\n${header} appears stalled${forLine}. It is still running but has made no progress. Consider checking on it, sending it a nudge, or cancelling it.\n</actor-notification>`
  }
  return `<actor-notification>\n${header} was cancelled.\n</actor-notification>`
}

export type ParsedActorNotification = {
  // "stalled" is reserved for a future watchdog-emitted notification;
  // renderActorNotification never produces it today (only completed/failed/
  // cancelled). The parse + card styling exist ahead of that producer.
  status: "completed" | "failed" | "cancelled" | "stalled"
  description: string
  summary?: string
}

// Inverse of renderActorNotification: recover the structured fields from the
// pre-rendered <actor-notification> text so the TUI can show a card instead of
// the raw wrapper. Pure + exported so it's unit-testable without the renderer.
// Returns null for any text that isn't an actor notification.
export function parseActorNotification(text: string): ParsedActorNotification | null {
  if (!text.trimStart().startsWith("<actor-notification>")) return null
  const header = text.match(/Background actor "(.*?)" \(actor_id: [^)]*\)\s+(completed|failed|was cancelled|stalled)\b/)
  if (!header) return null
  const description = header[1]
  const verb = header[2]
  const status: ParsedActorNotification["status"] =
    verb === "completed" ? "completed" : verb === "failed" ? "failed" : verb === "stalled" ? "stalled" : "cancelled"
  // Prefer the most human-relevant one-liner: Summary > Result > Error.
  // renderActorNotification always emits the Summary line before the Result
  // line, so restrict the Summary match to the region before the first
  // "Result:" line — otherwise a `Summary:`-prefixed line inside the Result
  // body would be mistaken for the notification's own summary.
  const resultIdx = text.search(/^Result:/m)
  const beforeResult = resultIdx === -1 ? text : text.slice(0, resultIdx)
  const line = (label: string, scope: string) => scope.match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]?.trim()
  const summary = line("Summary", beforeResult) ?? line("Result", text) ?? line("Error", text)
  return summary ? { status, description, summary } : { status, description }
}
