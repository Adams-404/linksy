# Linksy 📱⚡

> **Effortless reverse USB tethering for Linux.**  
> Share your laptop's Wi-Fi internet connection to your Android phone over a USB cable — no root required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux-blue.svg)](https://kernel.org)

---

## The Problem & The Solution

Most laptop Wi-Fi cards (particularly Intel `iwlwifi` and similar single-radio chips) cannot run in Access Point (AP / hotspot) mode while remaining connected to a Wi-Fi network. In practice, attempting to activate an `nmcli` or GUI hotspot drops the laptop's existing wireless connection. The reliable wireless-radio-free solution is **reverse USB tethering**: your laptop stays connected to Wi-Fi, and shares that connection with your Android device over a standard USB cable using a VPN-style bridge. **Linksy** wraps `adb` and `gnirehtet` into a friendly, single-command CLI experience that handles dependency installation, binary resolution, phone detection, and daemon management with zero manual file hunting.

---

## Installation

### One-line Setup (No global install required)

```bash
npx linksy setup
```

### Or install globally via npm

```bash
npm install -g linksy
linksy setup
```

`linksy setup` will:
1. Detect your Linux distribution.
2. Check for `adb` (Android Debug Bridge) and offer to install it automatically via your package manager (`dnf`, `apt`, `pacman`, or `zypper`) if missing.
3. Inspect your Wi-Fi interface capabilities (`iw list`) and let you know if your hardware supports concurrent hotspot mode.
4. Dynamically resolve and download the latest Gnirehtet release from GitHub directly into `~/.linksy/gnirehtet/`.
5. Set permissions and prepare everything for one-word commands.

---

## Daily Usage

| Command | Description |
| :--- | :--- |
| `linksy on` | Start reverse tethering in background (or pass `-f` / `--foreground`) |
| `linksy off` | Stop reverse tethering and disconnect the phone tunnel |
| `linksy status` | Display Gnirehtet install, connected phone, and tethering state |
| `linksy doctor` | Run 4-step diagnostic checks with actionable fix suggestions |
| `linksy uninstall` | Clean up `~/.linksy/` binaries and temporary files |

### Example Workflow

```bash
# 1. Plug in your Android phone via USB
# 2. Start tethering
linksy on

# 3. Unlock phone and accept the VPN prompt on screen
# Enjoy shared high-speed internet!

# 4. Check connection status
linksy status

# 5. Stop when finished
linksy off
```

---

## Supported Distributions (v1)

Linksy v1 supports **Linux** with automatic package manager detection for:
- **Fedora / RHEL / CentOS Stream** (`dnf`)
- **Ubuntu / Debian / Linux Mint** (`apt`)
- **Arch Linux / Manjaro** (`pacman`)
- **openSUSE** (`zypper`)

*Manual fallback instructions are provided if your package manager is unrecognized.*

---

## Diagnostics (`linksy doctor`)

If your phone is not connecting, run:

```bash
linksy doctor
```

Linksy doctor checks:
1. Is `adb` installed and on your system `PATH`?
2. Is the `gnirehtet` binary present and executable in `~/.linksy/`?
3. Is a physical Android phone detected via USB?
4. Is USB debugging authorized (i.e. RSA key accepted on the phone screen)?

For any failed step, `doctor` provides an immediate, copy-pasteable fix.

---

## Hardware Testing Checklist

For verifying Linksy on real hardware:

- [ ] **Prerequisites**: USB cable with data support (not charge-only), Android phone (Android 5.0+).
- [ ] **USB Debugging**: On your phone, go to **Settings** → **About phone** → tap **Build number** 7 times. Go to **Developer options** → toggle **USB debugging** ON.
- [ ] **Plug In**: Connect phone to laptop via USB.
- [ ] **Verify Device**: Run `adb devices`. You should see `<serial>  device` or `<serial>  unauthorized`.
- [ ] **Run Doctor**: Run `linksy doctor` to confirm all 4 checks pass.
- [ ] **Start Tethering**: Run `linksy on`.
- [ ] **Authorize on Phone**: Tap **OK** on the "Connection request" (Gnirehtet VPN prompt) on your phone.
- [ ] **Test Connectivity**: Turn off Cellular Data and Wi-Fi on your phone. Open a browser on the phone and verify internet access works!
- [ ] **Stop**: Run `linksy off` and confirm the VPN closes.

---

## Roadmap (Out of Scope for v1)

The following features are planned for future versions:
- macOS & Windows platform support
- Fallback to Bluetooth reverse tethering
- System tray / desktop GUI app
- iOS reverse tethering support

---

## Credits & Acknowledgements

Linksy is a UX wrapper and workflow orchestrator. It builds upon these open-source tools:
- **[Gnirehtet](https://github.com/Genymobile/gnirehtet)** by Genymobile — the reverse tethering engine and Android VPN client.
- **[Android Debug Bridge (adb)](https://developer.android.com/tools/adb)** by the Android Open Source Project (AOSP).

---

## License

[MIT License](LICENSE) © 2026 Linksy Contributors
