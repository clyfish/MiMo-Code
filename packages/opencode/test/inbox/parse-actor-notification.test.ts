import { describe, expect, test } from "bun:test"
import { parseActorNotification, renderActorNotification } from "../../src/inbox/render"

describe("parseActorNotification", () => {
  test("parses a completed notification with reported status + summary", () => {
    const text = renderActorNotification({
      actorID: "explore-1",
      description: "Find error recovery",
      status: "completed",
      reportedStatus: "success",
      reportedSummary: "Located 3 recovery sites",
      result: "full body here",
    })
    expect(parseActorNotification(text)).toEqual({
      status: "completed",
      description: "Find error recovery",
      summary: "Located 3 recovery sites",
    })
  })

  test("completed without a summary falls back to the Result line", () => {
    const text = renderActorNotification({
      actorID: "explore-2",
      description: "Scan repo",
      status: "completed",
      reportedStatus: "success",
      result: "42 files scanned",
    })
    expect(parseActorNotification(text)).toEqual({
      status: "completed",
      description: "Scan repo",
      summary: "42 files scanned",
    })
  })

  test("completed without a summary does not mistake an embedded Summary: line in the Result body", () => {
    const text = renderActorNotification({
      actorID: "explore-3",
      description: "Draft report",
      status: "completed",
      reportedStatus: "success",
      result: "Here is the outline:\nSummary: this is inside the result body\nmore text",
    })
    expect(parseActorNotification(text)).toEqual({
      status: "completed",
      description: "Draft report",
      summary: "Here is the outline:",
    })
  })

  test("parses a failed notification with the Error line as summary", () => {
    const text = renderActorNotification({
      actorID: "general-9",
      description: "Type checker review",
      status: "failed",
      error: "process exited 1",
    })
    expect(parseActorNotification(text)).toEqual({
      status: "failed",
      description: "Type checker review",
      summary: "process exited 1",
    })
  })

  test("parses a cancelled notification (no summary)", () => {
    const text = renderActorNotification({
      actorID: "peer-3",
      description: "Long running search",
      status: "cancelled",
    })
    expect(parseActorNotification(text)).toEqual({
      status: "cancelled",
      description: "Long running search",
    })
  })

  test("parses a stalled notification (watchdog variant)", () => {
    const text =
      '<actor-notification>\nBackground actor "Wedged agent" (actor_id: general-7) stalled.\nSummary: no output for 10m\n</actor-notification>'
    expect(parseActorNotification(text)).toEqual({
      status: "stalled",
      description: "Wedged agent",
      summary: "no output for 10m",
    })
  })

  test("returns null for non-notification text", () => {
    expect(parseActorNotification("just a normal user message")).toBeNull()
    expect(parseActorNotification("<inbox from=\"x:y\">hello</inbox>")).toBeNull()
    expect(parseActorNotification("")).toBeNull()
  })

  test("returns null when the wrapper is present but the header is malformed", () => {
    expect(parseActorNotification("<actor-notification>\ngarbage\n</actor-notification>")).toBeNull()
  })
})
