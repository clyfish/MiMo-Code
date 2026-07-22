import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ToolRegistry } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { ProviderID, ModelID } from "../../src/provider/schema"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

const it = testEffect(
  Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

afterEach(async () => {
  await Instance.disposeAll()
})

describe("ToolRegistry.tools: invocation style resolution", () => {
  it.live("masks skill_search for GPT and Claude models", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")
        const ids = (modelID: string) =>
          reg
            .tools({
              providerID: ProviderID.opencode,
              modelID: ModelID.make(modelID),
              agent: general,
            })
            .pipe(Effect.map((tools) => tools.map((tool) => tool.id)))

        expect(yield* ids("openai/gpt-5.4")).not.toContain("skill_search")
        expect(yield* ids("anthropic/claude-sonnet-4-6")).not.toContain("skill_search")
        expect(yield* ids("mimo-v2")).toContain("skill_search")
      }),
    ),
  )

  it.live("uses the filesystem-capable bash description for GPT models", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")
        const tools = yield* reg.tools({
          providerID: ProviderID.make("openai"),
          modelID: ModelID.make("gpt-5"),
          agent: general,
        })
        const bash = tools.find((tool) => tool.id === "bash")
        expect(bash?.description).toContain("the dedicated `read`, `write`, and `edit` tools are unavailable")
        expect(bash?.description).toContain("Use `apply_patch`")
        expect(bash?.description).not.toContain("DO NOT use it for file operations")
        expect(tools.some((tool) => tool.id === "notebook_edit")).toBeFalse()
      }),
    ),
  )

  it.live("keeps the specialized-tool bash description for non-GPT models", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")
        const tools = yield* reg.tools({
          providerID: ProviderID.opencode,
          modelID: ModelID.make("opencode/claude-sonnet-4-6"),
          agent: general,
        })
        const bash = tools.find((tool) => tool.id === "bash")
        expect(bash?.description).toContain("DO NOT use it for file operations")
        expect(bash?.description).not.toContain("the dedicated `read`, `write`, and `edit` tools are unavailable")
        expect(tools.some((tool) => tool.id === "notebook_edit")).toBeTrue()
      }),
    ),
  )

  it.live("default config keeps task in JSON mode", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")
        const tools = yield* reg.tools({
          providerID: ProviderID.opencode,
          modelID: ModelID.make("opencode/claude-sonnet-4-6"),
          agent: general,
        })
        const task = tools.find((t) => t.id === "task")
        expect(task).toBeDefined()
        // JSON mode → parameters is an object wrapping an `operation` discriminated
        // union (discriminator "action"). Confirm `operation` is present and `script`
        // (the shell-mode shape) is not.
        const schema = task!.parameters as any
        expect(schema.shape?.operation ?? schema._def?.shape?.operation).toBeDefined()
        expect(schema.shape?.script ?? schema._def?.shape?.script).toBeUndefined()
      }),
    ),
  )

  it.live(
    "invocationStyleByTool.task='shell' replaces parameters with { script } once shell field exists",
    () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const reg = yield* ToolRegistry.Service
            const agents = yield* Agent.Service
            const general = yield* agents.get("general")
            if (!general) throw new Error("no general agent")
            const tools = yield* reg.tools({
              providerID: ProviderID.opencode,
              modelID: ModelID.make("opencode/claude-sonnet-4-6"),
              agent: general,
            })
            const task = tools.find((t) => t.id === "task")
            expect(task).toBeDefined()
            // Task has shell field (Task 13 added it). Shell mode is active: parameters has `script`.
            const schema = task!.parameters as any
            expect(schema.shape?.script ?? schema._def?.shape?.script).toBeDefined()
            expect(schema.shape?.action ?? schema._def?.shape?.action).toBeUndefined()
          }),
        { config: { tool: { invocation_style_by_tool: { task: "shell" } } } },
      ),
  )

  it.live("invocationStyleByTool.read='shell' falls back to JSON (read has no shell field)", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const reg = yield* ToolRegistry.Service
          const agents = yield* Agent.Service
          const general = yield* agents.get("general")
          if (!general) throw new Error("no general agent")
          const tools = yield* reg.tools({
            providerID: ProviderID.opencode,
            modelID: ModelID.make("opencode/claude-sonnet-4-6"),
            agent: general,
          })
          const read = tools.find((t) => t.id === "read")
          expect(read).toBeDefined()
          const schema = read!.parameters as any
          // Original `read` parameters has file_path; shell wrap would expose `script`
          expect(schema.shape?.file_path ?? schema._def?.shape?.file_path).toBeDefined()
          expect(schema.shape?.script ?? schema._def?.shape?.script).toBeUndefined()
        }),
      { config: { tool: { invocation_style_by_tool: { read: "shell" } } } },
    ),
  )
})

describe("ToolRegistry.tools: shell mode end-to-end on task", () => {
  it.live("task shell-mode resolves to shellInputSchema parameters and shell description", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const reg = yield* ToolRegistry.Service
          const agents = yield* Agent.Service
          const general = yield* agents.get("general")
          if (!general) throw new Error("no general agent")
          const tools = yield* reg.tools({
            providerID: ProviderID.opencode,
            modelID: ModelID.make("opencode/claude-sonnet-4-6"),
            agent: general,
          })
          const task = tools.find((t) => t.id === "task")!
          // Sanity: parameters is shellInputSchema (just `script`)
          const parsed = task.parameters.parse({ script: "task list" })
          expect(parsed).toEqual({ script: "task list" })
          // Description starts with the task.shell.txt header
          expect(task.description).toContain("Persistent work-item tool (shell form)")
          // Description is NOT the JSON-mode task.txt
          expect(task.description).not.toContain('"action": "create"')
        }),
      { config: { tool: { invocation_style_by_tool: { task: "shell" } } } },
    ),
  )
})
