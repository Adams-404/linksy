# Linksy — Build Spec & Agent Prompt

Copy everything below the line into your Antigravity CLI (or any coding agent). It's written as a full spec so the agent doesn't need to guess anything.

---

## AGENT PROMPT (paste this whole thing)

You are building **Linksy**, an npm-distributed CLI tool for Linux that lets a laptop with a single-radio Wi-Fi card share its internet connection to an Android phone over a USB cable (reverse USB tethering), without needing root on the phone. It wraps `adb` + `gnirehtet` into a clean, guided CLI experience.

### Background / why this exists

Most laptop Wi-Fi cards (especially Intel `iwlwifi`) cannot run in AP mode (hotspot) and stay connected to Wi-Fi at the same time, even though `iw list` sometimes claims "AP + managed" concurrent support — in practice, activating a `nmcli` hotspot drops the existing Wi-Fi connection. The reliable wireless-radio-free workaround is **reverse USB tethering**: the laptop stays connected to Wi-Fi, and shares that connection to the phone over the USB cable using `gnirehtet` (a VPN-style Android app + desktop relay, no root required) with `adb` handling the USB bridge.

Doing this manually today requires:
1. Installing `android-tools` (adb)
2. Finding the correct current Gnirehtet GitHub release asset (asset naming has changed between versions — e.g. `gnirehtet-linux64-*` vs `gnirehtet-rust-linux64-*` — and hardcoded URLs break)
3. Downloading, unzipping, and placing it somewhere sane (not `~/Downloads`, which people accidentally clear)
4. Manually creating shell aliases for `on`/`off`
5. Debugging `adb devices` not detecting the phone (USB debugging not enabled, drivers, permissions)

Linksy automates all of this into a few commands.

### Product goals

- **One-line install**: `npx linksy setup` or `npm install -g linksy && linksy setup`
- **Zero manual file hunting**: dynamically resolve the latest Gnirehtet release from GitHub's API (never hardcode a version/filename — asset names have changed before and will again)
- **Safe, fixed install location**: `~/.linksy/` (never `~/Downloads` or anywhere a user might casually delete)
- **Simple daily commands**: `linksy on`, `linksy off`, `linksy status`
- **Helpful diagnostics**: if `adb devices` doesn't show the phone, walk the user through enabling USB debugging, checking cable, checking `adb` permissions
- **Distro-aware dependency install**: detect `dnf` (Fedora), `apt` (Debian/Ubuntu), `pacman` (Arch) and install `android-tools`/`adb` automatically, with a manual fallback message for unsupported package managers
- **Optional smart check**: before recommending USB tethering at all, run `iw list` and parse "valid interface combinations" to tell the user if their Wi-Fi card *does* support simultaneous AP+managed mode — in that case, suggest `nmcli device wifi hotspot` directly instead of USB tethering, since that'd be simpler for them
- **No sudo surprises**: only prompt for `sudo` explicitly when installing system packages (`adb`), and explain why before running

### Tech stack

- **Node.js CLI**, using `commander` for command parsing and `chalk`/`ora` (or similar) for clean terminal output
- Distributed via **npm**, runnable via `npx linksy <command>` without global install
- Shells out to system commands (`adb`, `unzip`, `iw`, package managers) via `execa` or Node's `child_process`
- No bundled binaries — Gnirehtet's actual release zip is downloaded fresh from GitHub at setup time (respects licensing, always gets the current version, avoids repo bloat)

### CLI commands to implement

```
linksy setup       # first-time setup: checks deps, installs adb if missing,
                    # downloads latest gnirehtet release, installs to ~/.linksy/,
                    # checks Wi-Fi card capability, prints next steps
linksy on           # runs `gnirehtet run` (assumes phone is plugged in)
linksy off           # runs `gnirehtet stop`
linksy status        # shows: is gnirehtet installed, is a phone currently
                    # detected via `adb devices`, is tethering currently active
linksy doctor        # diagnostics: checks adb install, USB debugging status,
                    # phone detection, gnirehtet binary presence, prints
                    # human-readable fixes for each failure
linksy uninstall     # removes ~/.linksy/ and any shell config linksy added
```

### Detailed setup flow (`linksy setup`)

1. **Detect OS** — bail cleanly with a clear message if not Linux (v1 is Linux-only; mention Mac/Windows support is planned)
2. **Check for `adb`**:
   - If missing, detect package manager (`dnf`, `apt`, `pacman`, `zypper`) and offer to install (`sudo dnf install android-tools` / `sudo apt install android-tools-adb` / `sudo pacman -S android-tools`)
   - If package manager isn't recognized, print manual instructions and a link
3. **Check Wi-Fi card capability** (optional but valuable):
   - Run `iw list`, parse `valid interface combinations` block
   - If a group contains both `AP` and `managed` together, print a note: "Your Wi-Fi card may support running a hotspot while staying connected — you could try `nmcli device wifi hotspot ifname <iface> ssid ... password ...` directly instead. Continuing with USB tethering setup anyway since it's more reliable."
   - This is informational only, never blocks setup
4. **Resolve latest Gnirehtet release dynamically**:
   - Call `https://api.github.com/repos/Genymobile/gnirehtet/releases/latest`
   - Parse `assets[].browser_download_url`, find the one matching pattern `*linux64*.zip` (do NOT hardcode `gnirehtet-linux64` or `gnirehtet-rust-linux64` — match a regex like `/linux64.*\.zip$/i` so future renames don't break it)
   - If no matching asset found, print a clear error with a link to the releases page instead of failing silently
5. **Download and extract**:
   - Download the zip to a temp dir
   - Extract to `~/.linksy/gnirehtet/`
   - `chmod +x` the `gnirehtet` binary
   - Clean up the temp zip
6. **Print success message** with the two commands the user needs: `linksy on` and `linksy off`
7. Do NOT silently edit `.bashrc`/`.zshrc` with raw `alias` lines — instead, since `linksy` is a real installed CLI command (via npm), the "alias" problem naturally disappears: `linksy on` IS the alias. No shell config editing needed at all. This is an intentional simplification over the manual approach.

### `linksy on` flow

1. Check `~/.linksy/gnirehtet/gnirehtet` exists — if not, tell user to run `linksy setup` first
2. Run `adb devices` — if no device listed, print a friendly message: "No phone detected. Make sure it's plugged in via USB and USB debugging is enabled (Settings → About phone → tap Build number 7 times → Developer options → USB debugging)." and exit
3. If device found, run `gnirehtet run` (spawn it, keep in foreground so Ctrl+C stops it cleanly, OR spawn detached with a PID file so `linksy off` can kill it precisely — prefer the PID-file approach so `linksy on` returns control to the terminal and `linksy off` works from a separate terminal without needing Ctrl+C)
4. Print: "Approve the connection prompt on your phone." and "Run `linksy off` to stop."

### `linksy off` flow

1. Read stored PID (if using the PID-file approach) or just run `gnirehtet stop`
2. Confirm it stopped, print a confirmation

### `linksy doctor` flow

Check each of the following in order and print ✅/❌ with a one-line fix suggestion for each ❌:
- Is `adb` installed and on PATH?
- Is `~/.linksy/gnirehtet/gnirehtet` present and executable?
- Does `adb devices` show at least one device (not "unauthorized")?
- Is the phone's USB debugging authorization confirmed (device state is `device` not `unauthorized`)?

### Project structure

```
linksy/
├── package.json          # bin field pointing to ./bin/linksy.js, npm metadata
├── bin/
│   └── linksy.js         # CLI entrypoint (shebang #!/usr/bin/env node)
├── src/
│   ├── commands/
│   │   ├── setup.js
│   │   ├── on.js
│   │   ├── off.js
│   │   ├── status.js
│   │   ├── doctor.js
│   │   └── uninstall.js
│   ├── lib/
│   │   ├── detectPackageManager.js
│   │   ├── installAdb.js
│   │   ├── checkWifiCapability.js   # parses `iw list`
│   │   ├── fetchLatestGnirehtet.js  # GitHub API + regex asset match
│   │   ├── downloadAndExtract.js
│   │   ├── adbHelpers.js            # wraps `adb devices` parsing
│   │   └── paths.js                 # centralizes ~/.linksy/ paths
│   └── utils/
│       └── logger.js                # chalk-based colored output helper
├── README.md
├── LICENSE                # MIT recommended
└── .gitignore
```

### README.md requirements

Must include:
- One-paragraph explanation of the problem (single-radio Wi-Fi limitation) and the fix
- Install instructions (`npx linksy setup` and `npm install -g linksy`)
- Usage: `linksy on` / `linksy off` / `linksy doctor`
- Supported distros for v1 (Fedora, Ubuntu/Debian, Arch)
- Credit to Gnirehtet (Genymobile) and adb (Android Open Source Project) as the tools this wraps — Linksy is a setup/UX wrapper, not a reimplementation
- License section (MIT)
- A note that Mac/Windows support is on the roadmap, not v1

### package.json requirements

- `"bin": { "linksy": "./bin/linksy.js" }`
- `"engines": { "node": ">=16" }`
- Dependencies: `commander`, `chalk`, `ora`, `execa` (or `node:child_process` if avoiding deps), `extract-zip` or `adm-zip` for unzipping, `node-fetch` (or native `fetch` if Node 18+)
- Keywords for npm discoverability: `["tethering", "usb-tethering", "android", "hotspot", "wifi", "linux", "gnirehtet", "adb"]`

### Error handling requirements

- Every shelled-out command (`adb`, `iw`, package manager installs) must have its stderr captured and surfaced in plain language, not raw stack traces, unless `--verbose` flag is passed
- Network failures fetching the GitHub API or downloading the release must retry once, then fail with a clear message and the manual fallback URL (https://github.com/Genymobile/gnirehtet/releases)
- Never assume `sudo` silently — always print what command is about to run and why before executing anything requiring elevated privileges

### Testing expectations

- Unit tests (Jest or Vitest) for the pure-logic pieces: `detectPackageManager.js`, `checkWifiCapability.js`'s parser, and the Gnirehtet asset-matching regex in `fetchLatestGnirehtet.js` (mock the GitHub API response)
- Manual test checklist in README or CONTRIBUTING.md for the parts that need real hardware (actual `adb devices` detection, actual tethering)

### Out of scope for v1 (note in README as roadmap, don't build yet)

- macOS/Windows support
- Bluetooth tethering fallback
- GUI/tray app
- iOS support

---

## AGENTS.md (drop this file in the repo root once created, for future AI coding sessions on this repo)

```markdown
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
```

---

## What to do with this

1. Create a new repo called `linksy` on GitHub
2. Paste the **AGENT PROMPT** section into your Antigravity CLI as the build instruction
3. Once it scaffolds, save the **AGENTS.md** block as an actual `AGENTS.md` file in the repo root — that's what keeps future AI coding sessions consistent with these decisions instead of re-deciding them differently each time
4. After it's built and working locally, `npm publish` to make `npx linksy setup` real for other people
