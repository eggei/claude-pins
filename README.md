# Pins for Claude Code

Pin a Claude Code reply, or just the part you selected, and reopen it from a pane beside the chat, so you stop scrolling back up for the block you keep referring to. Pins are kept across sessions.

## Use it

| Do this | To |
| --- | --- |
| `/pin [title]` | Pin your mouse selection (fullscreen mode), or the last reply when nothing is selected. The pin keeps the reply's markdown and links. |
| `/pins` | Show the Pins pane and move focus into it. |
| `/unpin <number\|all>` | Remove a pin by its number in the list, or all of them. |

All three run at once, even while Claude is mid-reply, and report with a toast instead of a line in the thread.

In the Pins pane (click it or press `ctrl+x tab` to focus it):

| Key | Action |
| --- | --- |
| ↑ / ↓ | Move between pins |
| Enter or `1`–`9` | Open a pin |
| `d` | Remove the focused pin |
| `r` | Refresh: picks up pins saved in another session (also happens on `/pins` and when you focus the pane), and updates each pin's session name if the session was renamed since |
| `b` / `c` / `d` | Inside an open pin: back, copy, unpin |
| `x` | Close the pane. It stays closed in every session (and `/pin` won't reopen it) until you run `/pins` again |

An open pin shows the date, the name of the session it was pinned from, and the project folder.

Clicking a link in an open pin opens it in your browser.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pins --marketplace eggei/claude-pins
```

From a shell:

```
claude plugin install pins --marketplace eggei/claude-pins
```

Requires Claude Code 2.1.275 or later in a terminal session.

## Optional keyboard shortcuts

Plugins can't ship key bindings, so add these to your own `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+x p": "command:pin",
        "ctrl+x up": "command:pins",
        "ctrl+x right": "command:pins"
      }
    },
    {
      "context": "Pane",
      "bindings": {
        "ctrl+x up": "command:pins",
        "ctrl+x right": "command:pins"
      }
    }
  ]
}
```

`ctrl+x p` pins, and `ctrl+x up` or `ctrl+x right` opens the Pins pane and jumps into it, from the chat input or from inside another pane. Keep them out of the `Global` context: a `ctrl+x` chord there can swallow the plain `ctrl+x` that agent view uses to stop a session. The `Pane` entries replace the default pane resize on those two keys; `ctrl+x left` and `ctrl+x down` still resize a pane. Claude Code won't move focus out of a chat input that has text in it, so with a draft typed, clear it first or use `ctrl+x tab`.

## Privacy

Pins are saved in Claude Code's plugin storage on your machine and never leave it. To show which session a pin came from, the plugin reads the session titles from your local transcripts under `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`). It makes no network requests; clicking a link in a pin opens it in your browser.

## License

[MIT](LICENSE). Pins is a community plugin and is not affiliated with or endorsed by Anthropic.
