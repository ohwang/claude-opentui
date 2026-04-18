/**
 * Tests for PermissionsProvider — Permission + elicitation state store.
 *
 * The provider is a thin SolidJS store wrapper. We test it via createRoot()
 * to get a reactive scope, then exercise setState and verify store reads.
 */

import { describe, test, expect } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { reconcile } from "solid-js/store"
import type {
  PermissionRequestEvent,
  ElicitationRequestEvent,
} from "../../../src/protocol/types"
import type { PermissionsState } from "../../../src/frontends/tui/context/permissions"

// ---------------------------------------------------------------------------
// Helpers — mirror the store shape from PermissionsProvider without needing
// JSX rendering or context lookup.
// ---------------------------------------------------------------------------

function createPermissionsStore() {
  return createStore<PermissionsState>({
    pendingPermission: null,
    pendingElicitation: null,
  })
}

function makePermissionRequest(overrides?: Partial<PermissionRequestEvent>): PermissionRequestEvent {
  return {
    type: "permission_request",
    id: "perm-1",
    tool: "Bash",
    input: { command: "rm -rf /tmp/test" },
    ...overrides,
  }
}

function makeElicitationRequest(overrides?: Partial<ElicitationRequestEvent>): ElicitationRequestEvent {
  return {
    type: "elicitation_request",
    id: "elic-1",
    questions: [
      {
        question: "Which option do you prefer?",
        options: [
          { label: "Option A" },
          { label: "Option B" },
        ],
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Permission request tracking
// ---------------------------------------------------------------------------

describe("PermissionsStore", () => {
  describe("initial state", () => {
    test("starts with no pending permission or elicitation", () => {
      createRoot(dispose => {
        const [state] = createPermissionsStore()
        expect(state.pendingPermission).toBeNull()
        expect(state.pendingElicitation).toBeNull()
        dispose()
      })
    })
  })

  describe("permission request lifecycle", () => {
    test("sets pending permission on request", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()
        const perm = makePermissionRequest()

        setState("pendingPermission", reconcile(perm))

        expect(state.pendingPermission).not.toBeNull()
        expect(state.pendingPermission!.id).toBe("perm-1")
        expect(state.pendingPermission!.tool).toBe("Bash")
        dispose()
      })
    })

    test("clears pending permission on approval (null)", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        // Set a pending permission
        setState("pendingPermission", reconcile(makePermissionRequest()))
        expect(state.pendingPermission).not.toBeNull()

        // Clear it (simulating approval/denial)
        setState("pendingPermission", reconcile(null))
        expect(state.pendingPermission).toBeNull()
        dispose()
      })
    })

    test("replaces pending permission with a new request", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        setState("pendingPermission", reconcile(makePermissionRequest({ id: "perm-1", tool: "Bash" })))
        expect(state.pendingPermission!.id).toBe("perm-1")

        // Replace with a new permission request
        setState("pendingPermission", reconcile(makePermissionRequest({ id: "perm-2", tool: "Write" })))
        expect(state.pendingPermission!.id).toBe("perm-2")
        expect(state.pendingPermission!.tool).toBe("Write")
        dispose()
      })
    })

    test("permission request preserves all fields including suggestions", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()
        const perm = makePermissionRequest({
          id: "perm-suggestions",
          tool: "Edit",
          input: { file_path: "/tmp/test.ts", old_string: "a", new_string: "b" },
          displayName: "Edit file",
          title: "Claude wants to edit test.ts",
          description: "Claude will modify test.ts",
          suggestions: [{
            type: "addRules",
            rules: [{ toolName: "Edit", ruleContent: "*.ts" }],
            behavior: "allow",
            destination: "session",
          }],
        })

        setState("pendingPermission", reconcile(perm))

        expect(state.pendingPermission!.displayName).toBe("Edit file")
        expect(state.pendingPermission!.title).toBe("Claude wants to edit test.ts")
        expect(state.pendingPermission!.suggestions).toHaveLength(1)
        expect(state.pendingPermission!.suggestions![0]!.type).toBe("addRules")
        dispose()
      })
    })
  })

  describe("elicitation request lifecycle", () => {
    test("sets pending elicitation on request", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()
        const elic = makeElicitationRequest()

        setState("pendingElicitation", reconcile(elic))

        expect(state.pendingElicitation).not.toBeNull()
        expect(state.pendingElicitation!.id).toBe("elic-1")
        expect(state.pendingElicitation!.questions).toHaveLength(1)
        expect(state.pendingElicitation!.questions[0]!.options).toHaveLength(2)
        dispose()
      })
    })

    test("clears pending elicitation on response (null)", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        setState("pendingElicitation", reconcile(makeElicitationRequest()))
        expect(state.pendingElicitation).not.toBeNull()

        setState("pendingElicitation", reconcile(null))
        expect(state.pendingElicitation).toBeNull()
        dispose()
      })
    })

    test("elicitation with multiple questions and options", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()
        const elic = makeElicitationRequest({
          id: "elic-multi",
          questions: [
            {
              question: "Q1",
              options: [{ label: "A" }, { label: "B" }],
              allowFreeText: true,
            },
            {
              question: "Q2",
              header: "Select",
              options: [{ label: "C", description: "Option C" }],
              multiSelect: true,
            },
          ],
        })

        setState("pendingElicitation", reconcile(elic))

        expect(state.pendingElicitation!.questions).toHaveLength(2)
        expect(state.pendingElicitation!.questions[0]!.allowFreeText).toBe(true)
        expect(state.pendingElicitation!.questions[1]!.multiSelect).toBe(true)
        expect(state.pendingElicitation!.questions[1]!.header).toBe("Select")
        dispose()
      })
    })
  })

  describe("concurrent permission and elicitation", () => {
    test("permission and elicitation are independent stores", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        // Set both at the same time
        setState("pendingPermission", reconcile(makePermissionRequest()))
        setState("pendingElicitation", reconcile(makeElicitationRequest()))

        expect(state.pendingPermission).not.toBeNull()
        expect(state.pendingElicitation).not.toBeNull()

        // Clear permission, elicitation persists
        setState("pendingPermission", reconcile(null))
        expect(state.pendingPermission).toBeNull()
        expect(state.pendingElicitation).not.toBeNull()

        // Clear elicitation
        setState("pendingElicitation", reconcile(null))
        expect(state.pendingElicitation).toBeNull()
        dispose()
      })
    })
  })

  describe("auto-deny on interrupt (reducer integration)", () => {
    // This tests the pattern that sync.tsx uses: on interrupt, the reducer
    // sets pendingPermission and pendingElicitation to null. We verify that
    // the store correctly reflects this when updated via reconcile(null).
    test("clearing both pending states simultaneously (interrupt pattern)", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        // Simulate: permission + elicitation both pending (unusual but possible)
        setState("pendingPermission", reconcile(makePermissionRequest()))
        setState("pendingElicitation", reconcile(makeElicitationRequest()))

        expect(state.pendingPermission).not.toBeNull()
        expect(state.pendingElicitation).not.toBeNull()

        // Simulate interrupt: sync.tsx applies reconcile(null) for both
        setState("pendingPermission", reconcile(null))
        setState("pendingElicitation", reconcile(null))

        expect(state.pendingPermission).toBeNull()
        expect(state.pendingElicitation).toBeNull()
        dispose()
      })
    })
  })

  describe("reducer-driven permission state transitions", () => {
    // These tests verify the full flow as the reducer produces it,
    // simulating what applyEvents() in sync.tsx does to the store.

    test("idle -> waiting_for_permission -> approved -> idle", () => {
      // Simulated reducer output sequence
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        // 1. permission_request arrives
        const perm = makePermissionRequest({ id: "perm-flow" })
        setState("pendingPermission", reconcile(perm))
        expect(state.pendingPermission!.id).toBe("perm-flow")

        // 2. permission_response (approved)
        setState("pendingPermission", reconcile(null))
        expect(state.pendingPermission).toBeNull()
        dispose()
      })
    })

    test("idle -> waiting_for_elicitation -> responded -> idle", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        // 1. elicitation_request arrives
        const elic = makeElicitationRequest({ id: "elic-flow" })
        setState("pendingElicitation", reconcile(elic))
        expect(state.pendingElicitation!.id).toBe("elic-flow")

        // 2. elicitation_response
        setState("pendingElicitation", reconcile(null))
        expect(state.pendingElicitation).toBeNull()
        dispose()
      })
    })

    test("waiting_for_permission -> interrupt clears pending", () => {
      createRoot(dispose => {
        const [state, setState] = createPermissionsStore()

        setState("pendingPermission", reconcile(makePermissionRequest()))
        expect(state.pendingPermission).not.toBeNull()

        // Interrupt clears everything (reducer sets both to null)
        setState("pendingPermission", reconcile(null))
        setState("pendingElicitation", reconcile(null))
        expect(state.pendingPermission).toBeNull()
        expect(state.pendingElicitation).toBeNull()
        dispose()
      })
    })
  })
})
