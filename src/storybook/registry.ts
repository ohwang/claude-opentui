/**
 * Story Registry — ordered to match the real app's component tree.
 * No magic discovery. Add new story files here.
 */

import { headerStories } from "./stories/layout"
import { conversationStories } from "./stories/blocks"
import { dialogsStories } from "./stories/dialogs"
import { inputStories } from "./stories/streaming"
import { footerStories } from "./stories/tool-views"
import { overlaysStories } from "./stories/composite"
import { primitivesStories } from "./stories/primitives"
import type { Story, StoryCategory } from "./types"

/** Categories ordered to match the real app's component tree (top → bottom) */
export const categories: StoryCategory[] = [
  "Header",
  "Conversation",
  "Dialogs",
  "Input",
  "Footer",
  "Overlays",
  "Primitives",
]

/** All stories in component tree order */
export const stories: Story[] = [
  ...headerStories,
  ...conversationStories,
  ...dialogsStories,
  ...inputStories,
  ...footerStories,
  ...overlaysStories,
  ...primitivesStories,
]
