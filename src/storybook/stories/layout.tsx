/**
 * Stories for the Header category — top of the component tree.
 */

import type { Story } from "../types"
import { HeaderBar } from "../../frontends/tui/components/header-bar"
import { idleSession } from "../fixtures/state"

export const headerStories: Story[] = [
  {
    id: "header-bar",
    title: "HeaderBar",
    description: "Logo, model info, and project path",
    category: "Header",
    context: { session: idleSession() },
    render: () => <HeaderBar />,
  },
]
