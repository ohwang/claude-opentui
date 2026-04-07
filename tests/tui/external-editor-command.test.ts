import { describe, expect, it } from "bun:test"
import { parseCommandString } from "../../src/tui/components/input-area"

describe("parseCommandString", () => {
  it("preserves quoted macOS app names with spaces", () => {
    expect(parseCommandString('open -a "Visual Studio Code" --wait-apps')).toEqual([
      "open",
      "-a",
      "Visual Studio Code",
      "--wait-apps",
    ])
  })

  it("preserves escaped spaces in macOS app bundle paths", () => {
    expect(
      parseCommandString("/Applications/Visual\\ Studio\\ Code.app/Contents/Resources/app/bin/code --wait"),
    ).toEqual([
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "--wait",
    ])
  })

  it("keeps quoted arguments together", () => {
    expect(parseCommandString("code --wait --profile 'My Profile'")).toEqual([
      "code",
      "--wait",
      "--profile",
      "My Profile",
    ])
  })
})
