/**
 * Theme Registry — stores and retrieves theme presets.
 *
 * Pre-registers built-in themes. External themes (community, user-defined)
 * can be registered at startup before render() is called.
 */

import type { ThemeDefinition } from "./types"
import { defaultDark } from "./presets/default-dark"
import { highContrast } from "./presets/high-contrast"
import { catppuccinMocha } from "./presets/catppuccin-mocha"
import { dracula } from "./presets/dracula"
import { snazzy } from "./presets/snazzy"
import { solarizedDark } from "./presets/solarized-dark"
import { light } from "./presets/light"
import { oneLight } from "./presets/one-light"

const themes = new Map<string, ThemeDefinition>()

// Register built-in themes
themes.set(defaultDark.id, defaultDark)
themes.set(highContrast.id, highContrast)
themes.set(catppuccinMocha.id, catppuccinMocha)
themes.set(dracula.id, dracula)
themes.set(snazzy.id, snazzy)
themes.set(solarizedDark.id, solarizedDark)
themes.set(light.id, light)
themes.set(oneLight.id, oneLight)

/** Register a theme preset. Overwrites if the ID already exists. */
export function registerTheme(theme: ThemeDefinition): void {
  themes.set(theme.id, theme)
}

/** Look up a theme by ID. */
export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.get(id)
}

/** List all registered themes. */
export function listThemes(): ThemeDefinition[] {
  return [...themes.values()]
}
