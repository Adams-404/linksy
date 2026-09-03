# AGENTS.md — Linksy

## What this project is
Linksy is an npm CLI tool that automates reverse USB tethering on Linux
(sharing a laptop's Wi-Fi internet to an Android phone over USB cable)
by wrapping `adb` and `gnirehtet`. See README.md for the full pitch.

## Core invariant — never hardcode Gnirehtet release URLs or filenames
Gnirehtet's GitHub release asset naming has changed before (e.g.
`gnirehtet-linux64-*.zip` → `gnirehtet-rust-linux64-*.zip`). Any code that
resolves a Gnirehtet download URL MUST do so dynamically via the GitHub
API (`/repos/Genymobile/gnirehtet/releases/latest`) and match assets with
a permissive regex (`/linux64.*\.zip$/i`), never a hardcoded string. This
has broken real users before — do not regress it.

## Install location invariant
Everything Linksy downloads goes in `~/.linksy/`. Never `~/Downloads` or
any path a user might casually clean up. This was a deliberate fix from
early manual testing where a Downloads-based install caused confusion.

## Command naming
Commands are `linksy setup|on|off|status|doctor|uninstall`. Keep these
short — the whole point of this tool is reducing multi-step manual
commands to one word.

## Style
- Plain, friendly terminal output (this tool is aimed at non-expert Linux
  users), not terse Unix-tool style. Every error should suggest a fix, not
  just state the failure.
- Distro support for v1: Fedora (dnf), Ubuntu/Debian (apt), Arch (pacman)
  only. Don't silently assume apt on unknown systems.

## Do not build yet (see README roadmap)
macOS/Windows support, Bluetooth fallback, GUI app, iOS support.
