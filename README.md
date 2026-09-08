# Linksy PhoneNet 📱⚡

> **Effortless reverse USB tethering for Linux.**  
> Share your laptop's Wi-Fi internet connection to your Android phone over a USB cable — no root required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux-blue.svg)](https://kernel.org)

---

## The Problem & The Solution

Most laptop Wi-Fi cards (particularly Intel `iwlwifi` and similar single-radio chips) cannot run in Access Point (AP / hotspot) mode while remaining connected to a Wi-Fi network. In practice, attempting to activate an `nmcli` or GUI hotspot drops the laptop's existing wireless connection. The reliable wireless-radio-free solution is **reverse USB tethering**: your laptop stays connected to Wi-Fi, and shares that connection with your Android device over a standard USB cable using a VPN-style bridge. **Linksy PhoneNet** wraps `adb` and `gnirehtet` into a friendly, single-command CLI experience that handles dependency installation, binary resolution, phone detection, and daemon management with zero manual file hunting.

---

## Installation

### One-line Setup

```bash
npx linksy-phonenet setup
```

### Or install globally via npm

```bash
npm install -g linksy-phonenet
linksy-phonenet setup
```

`linksy-phonenet setup` will:
1. Detect your Linux distribution.
2. Check for `adb` (Android Debug Bridge) and offer to install it automatically via your package manager (`dnf`, `apt`, `pacman`, or `zypper`) if missing.
3. Inspect your Wi-Fi interface capabilities (`iw list`) and let you know if your hardware supports concurrent hotspot mode.
4. Dynamically resolve and download the latest Gnirehtet release from GitHub directly into `~/.linksy/gnirehtet/`.
5. Set permissions and prepare everything for one-word commands.

---

## Daily Usage

You can connect your phone using **Wi-Fi Hotspot (Wireless)**, **Bluetooth (Wireless)**, or **USB Cable (Wired)**:

### Connection Modes

| Mode | Command | Best For | Description |
| :--- | :--- | :--- | :--- |
| **Wi-Fi Hotspot (Wireless)** | `linksy on --wifi`<br>`phonenet-on -w` | High-speed wireless | Broadcasts a concurrent Wi-Fi hotspot on the matching channel. Connect your phone via standard Wi-Fi (no cable or phone app needed). |
| **Bluetooth (Wireless)** | `linksy on --bluetooth`<br>`phonenet-on -b` | Universal wireless fallback | Reverse tethers over Bluetooth PAN. Toggle "Internet access" in phone Bluetooth settings. |
| **USB Cable (Wired)** | `linksy on`<br>`phonenet-on` | Fast wired tethering | Reverse USB tethering via ADB + Gnirehtet VPN tunnel. |

### Commands Table

### Direct Shortcuts
| Command | Description |
| :--- | :--- |
| `phonenet-on` | Start reverse tethering (pass `-w` for Wi-Fi, `-b` for Bluetooth) |
| `phonenet-off` | Stop all active Linksy connections (USB, Wi-Fi hotspot, or Bluetooth) |
| `phonenet-status` | Display status across USB, Wi-Fi hotspot, and Bluetooth PAN |
| `phonenet-doctor` | Run diagnostic checks for ADB, Wi-Fi AP capability, and Bluetooth |

### Subcommands (`phonenet` or `linksy-phonenet`)
| Command | Description |
| :--- | :--- |
| `linksy on` | Start USB tethering (options: `-w` / `--wifi`, `-b` / `--bluetooth`, `-s` / `--ssid <name>`, `-p` / `--password <pass>`, `--no-password`) |
| `linksy off` | Stop all active tethering and hotspot services |
| `linksy status` | Display status of USB, Wi-Fi hotspot, connected devices, and Bluetooth sessions |
| `linksy devices` | View connected devices with hostname, IP, MAC, signal strength, and transfer stats |
| `linksy block <device>` | Disconnect and blacklist a device by hostname, IP, or MAC address |
| `linksy unblock <device>` | Remove a device from the blacklist |
| `linksy whitelist <device>` | Whitelist a device (pass `--remove` to unwhitelist) |
| `linksy doctor` | Comprehensive diagnostic checks with copy-pasteable fix commands |
| `linksy uninstall` | Clean up `~/.linksy/` binaries and temporary files |

### Example Workflows

#### 1. Wirelessly via Wi-Fi Hotspot (High Speed, No Cable)
```bash
# Start concurrent Wi-Fi hotspot on the matching channel
linksy on --wifi

# Or specify a custom network name and password (saved as your default):
linksy on --wifi --ssid "MyNetwork" --password "<your-password>"
# Shorthand:
linksy on -w -s "MyNetwork" -p "<your-password>"

# Or run with NO password (open network):
linksy on --wifi --no-password

# On your phone: Open Wi-Fi settings, connect to your network
# Enjoy high-speed wireless internet shared from your laptop!

# See who is connected to your hotspot (device name, IP, signal, data usage):
linksy devices

# Check connection status & password anytime:
linksy status

# Block an unwanted device (by name, IP, or MAC):
linksy block 192.168.42.29
# or by MAC:
linksy block aa:bb:cc:dd:ee:ff

# Unblock a device:
linksy unblock aa:bb:cc:dd:ee:ff

# Disconnect when finished:
linksy off
```

#### 2. Wirelessly via Bluetooth (No Cable)
```bash
# Start Bluetooth reverse tethering
linksy on --bluetooth

# On your phone: Settings → Bluetooth → tap laptop → toggle ON "Internet access"
# Disconnect when finished
linksy off
```

#### 3. Over USB Cable (Wired)
```bash
# 1. Plug in your Android phone via USB
# 2. Turn on tethering
phonenet-on

# 3. Accept the VPN prompt on screen
# Disconnect when finished
phonenet-off
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
- Concurrent Wi-Fi AP+STA & Bluetooth wireless reverse tethering (see [Wireless Reverse Tethering Research](docs/wireless-reverse-tethering-research.md))
- macOS & Windows platform support
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
