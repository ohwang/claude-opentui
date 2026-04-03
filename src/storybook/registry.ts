/**
 * Story Registry — explicit imports of all story files.
 * No magic discovery. Add new story files here.
 */

import { primitivesStories } from "./stories/primitives"
import { blocksStories } from "./stories/blocks"
import { toolViewsStories } from "./stories/tool-views"
import { streamingStories } from "./stories/streaming"
import { layoutStories } from "./stories/layout"
import { dialogsStories } from "./stories/dialogs"
import { compositeStories } from "./stories/composite"
import type { Story, StoryCategory } from "./types"

export const categories: StoryCategory[] = [
  "Primitives",
  "Blocks",
  "Tool Views",
  "Streaming",
  "Layout",
  "Dialogs",
  "Composite",
]

export const stories: Story[] = [
  ...primitivesStories,
  ...blocksStories,
  ...toolViewsStories,
  ...streamingStories,
  ...layoutStories,
  ...dialogsStories,
  ...compositeStories,
]
