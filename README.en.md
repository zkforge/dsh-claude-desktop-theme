<div align="center">

# DSH Claude Desktop Theme

Bring the Claude Code Desktop look to DeepSeek Harness (DSH) Desktop.

[简体中文](README.md) · English

[Install](#quick-install) · [Screenshots](#screenshots) · [Configuration](#configuration) · [Architecture](ARCHITECTURE.md) · [Installation guide](install.md) · [Report an issue](https://github.com/zkforge/dsh-claude-desktop-theme/issues)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/fullscreen-light.webp" width="1200" alt="New session in the light theme, with the Claude pixel companion, usage statistics and animated ripples">
</p>

## Quick install

In DSH, open **Plugins → Add plugin** and enter `dsh-claude-desktop-theme`, or run:

```sh
dsh plugin --profile desktop add dsh-claude-desktop-theme
```

For installation from source and platform-specific CLI paths, see the [installation guide](install.md).

## Using the theme

Under **Settings → Claude Theme → Modules → Home background animation**, choose **Space explorer** for a pixel astronaut that drifts toward the mouse. Click an empty area to send a shooting star across the sky. You can also choose character ripples or turn the animation off.

Enter `/clear` in a conversation to clear its model context while keeping the same session, name, project, model, project instructions and skills. The original log remains available through **View history**. Run the command after the response finishes and the message queue is empty. Fully quit and reopen DSH after installation to load the host command.

## Screenshots

The previews show the macOS light and dark themes. The home page uses the Claude companion and greeting, ripples, and the statistics card.

| Screen | Light | Dark |
| --- | --- | --- |
| New session | ![New session, light](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/fullscreen-light.webp) | ![New session, dark](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/fullscreen-dark.webp) |
| Conversation | ![Conversation, light](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/chat-light.webp) | ![Conversation, dark](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/chat-dark.webp) |
| Session information | ![Session information, light](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/session-info-fullscreen-light.webp) | ![Session information, dark](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/session-info-fullscreen-dark.webp) |
| Settings | ![Settings, light](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/settings-light.webp) | ![Settings, dark](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/settings-dark.webp) |
| Model picker | ![Model picker, light](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/model-picker-light.webp) | ![Model picker, dark](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/model-picker-dark.webp) |
| Context breakdown | ![Context breakdown, light](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/context-panel-light.webp) | ![Context breakdown, dark](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/context-panel-dark.webp) |

Click the whale or Claude companion to play its reaction. Select the companion under **Settings → Claude Theme → Personalization → Pet style**.

<p align="center">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-spout.gif" width="150" alt="Whale spouting water">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-hop.gif" width="150" alt="Whale hopping">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-wag.gif" width="150" alt="Whale wagging its tail">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-claude.gif" width="150" alt="Claude companion typing on a laptop">
</p>

The highest effort setting adds an animated pixel effect.

<p align="center">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/effort/effort-light.gif" width="260" alt="Effort animation in the light theme">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/effort/effort-dark.gif" width="260" alt="Effort animation in the dark theme">
</p>

## Configuration

Open **Theme** in the sidebar or **Settings → Claude Theme**. Changes take effect immediately.

| Group | Options |
| --- | --- |
| Modules | Sidebars, new session, home background animation, conversation, tool calls, composer companion, statistics card, status-bar statistics and context breakdown |
| Appearance | System, light or dark theme, conversation background and sidebar background |
| View | API balance, model icons, separate model and effort controls, conversation process, sidebar brand, header entries and empty groups |
| Personalization | Companion, running status, reply signature and home greeting styles |
| Typefaces | Interface and code fonts. The Chinese interface font can be set in the profile's `cordis.patch.yml`. |

Custom background colours apply in light mode. The default font stacks begin with Anthropic Sans Web, Anthropic Serif Web and SF Mono. The repository includes fonts for local installation under `assets/fonts/`.

## Requirements

The DSH Desktop version range is `>=0.2.1-rc.3 <0.3.0-0`, allowing later `0.2.x` releases and prereleases, including `0.2.2-rc.1`. This range does not imply every version has been tested. The macOS Apple silicon build has been tested with rc5. Windows 10 and later (64-bit) installation is supported, though the newer Windows host build has yet to be verified. Building from source requires Node.js 22.18.0 or newer.

Fully quit and reopen DSH after upgrading to load host interfaces and session projections.

## Feedback and license

Use the feedback button beside the account menu or [open an issue](https://github.com/zkforge/dsh-claude-desktop-theme/issues) with your DSH version, window size and reproduction steps.

[MIT](LICENSE) © 2026 zkforge.
